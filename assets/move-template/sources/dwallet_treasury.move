/// DWallet Treasury — minimal complete Move module demonstrating Ika dWallet integration.
///
/// This module shows:
///   1. Storing a DWalletCap in a shared object (the treasury)
///   2. Multi-member approval workflow before signing
///   3. approve_message() to create a MessageApproval
///   4. request_sign_and_return_id() to submit the signature request
///   5. Session management with fresh object addresses
///   6. Payment handling with the withdraw-all / return-remainder pattern
///
/// Coordinator object IDs (pass these from TypeScript):
///   Testnet: 0x4d157b7415a298c56ec2cb1dcab449525fa74aec17ddba376a83a7600f2062fc
///   Mainnet: 0x5ea59bce034008a006425df777da925633ef384ce25761657ea89e2a08ec75f3
///
module dwallet_treasury::treasury;

use ika::ika::IKA;
use ika_dwallet_2pc_mpc::{
    coordinator::DWalletCoordinator,
    coordinator_inner::{
        DWalletCap,
        UnverifiedPresignCap,
        VerifiedPresignCap,
        MessageApproval,
    },
    sessions_manager::SessionIdentifier,
};
use sui::{
    balance::Balance,
    coin::Coin,
    sui::SUI,
    table::{Self, Table},
    vec_set::{Self, VecSet},
};

// ── Constants ──────────────────────────────────────────────────────────────────

/// Curve IDs
const SECP256K1: u32 = 0;
// const SECP256R1: u32 = 1;
// const ED25519: u32   = 2;

/// Signature algorithm IDs (relative to curve)
const ECDSA_SECP256K1: u32 = 0;
const TAPROOT: u32         = 1;
// const ED_DSA: u32          = 0;  // for ED25519

/// Hash scheme IDs (relative to curve + algorithm)
const SHA256: u32      = 1;
// const KECCAK256: u32   = 0;  // Ethereum
// const DOUBLE_SHA256: u32 = 2;  // Bitcoin

/// Minimum presign pool size before auto-replenishment
const MIN_POOL_SIZE: u64 = 3;

// ── Error codes ────────────────────────────────────────────────────────────────

const ENotMember: u64             = 0;
const EAlreadyVoted: u64          = 1;
const EAlreadyExecuted: u64       = 2;
const EInsufficientApprovals: u64 = 3;
const ENoPresigns: u64            = 4;
const EInvalidThreshold: u64      = 5;

// ── Structs ────────────────────────────────────────────────────────────────────

/// The shared treasury object. Holds the signing capability and manages approvals.
///
/// Stored as a SHARED object via transfer::public_share_object so all members
/// can call entry functions on it.
public struct Treasury has key, store {
    id: UID,

    /// The signing authority. This is the "private key" equivalent — whoever
    /// holds this object (or the contract that stores it) controls the dWallet.
    dwallet_cap: DWalletCap,

    /// Pool of pre-computed signing nonces. Each signature consumes one.
    /// Replenish with add_presigns() before the pool empties.
    presigns: vector<UnverifiedPresignCap>,

    /// Multi-member approval set. Members can create and vote on sign requests.
    members: VecSet<address>,

    /// Number of approvals required to execute a sign request.
    approval_threshold: u64,

    /// Pending sign requests awaiting member approval.
    requests: Table<u64, SignRequest>,
    next_request_id: u64,

    /// IKA balance for Ika protocol fees (required for presign/sign).
    ika_balance: Balance<IKA>,
    /// SUI balance for gas reimbursement mechanism in coordinator calls.
    sui_balance: Balance<SUI>,

    /// The network encryption key epoch this dWallet was created under.
    /// Used when requesting new presigns.
    dwallet_network_encryption_key_id: ID,
}

/// A pending signing request. Created in Phase 1 (future sign) and executed in Phase 2.
public struct SignRequest has store {
    id: u64,
    /// Raw bytes to sign (e.g. a Bitcoin txid, Ethereum calldata hash).
    message: vector<u8>,
    /// Partial signature from Phase 1. Consumed in Phase 2 (execute_request).
    partial_presign: Option<UnverifiedPresignCap>,
    /// Votes cast. Maps member address → true (approve) / false (reject).
    votes: Table<address, bool>,
    approvals: u64,
    rejections: u64,
    executed: bool,
}

// ── Constructor ────────────────────────────────────────────────────────────────

/// Create and share a new treasury.
///
/// Called ONCE after the DKG transaction that created the DWalletCap.
///
/// TypeScript:
///   const tx = new Transaction();
///   tx.moveCall({
///     target: `${PKG}::treasury::create`,
///     arguments: [
///       tx.object(dwalletCapId),          // DWalletCap (must be owned by sender)
///       tx.object(coordinatorId),
///       tx.object(networkEncKeyId),
///       tx.pure(bcs.vector(bcs.Address).serialize(memberAddresses)),
///       tx.pure(bcs.u64().serialize(approvalThreshold)),
///       tx.object(ikaCoinId),
///       tx.object(suiCoinId),
///     ],
///   });
public entry fun create(
    dwallet_cap: DWalletCap,
    coordinator: &mut DWalletCoordinator,
    dwallet_network_encryption_key_id: ID,
    member_addresses: vector<address>,
    approval_threshold: u64,
    initial_ika: Coin<IKA>,
    initial_sui: Coin<SUI>,
    ctx: &mut TxContext,
) {
    let len = member_addresses.length();
    assert!(approval_threshold > 0 && approval_threshold <= len, EInvalidThreshold);
    assert!(len > 0, ENotMember);

    // Deduplicate member addresses using VecSet
    let members = vec_set::empty<address>();
    let mut i = 0;
    while (i < len) {
        vec_set::insert(&mut members, *member_addresses.borrow(i));
        i = i + 1;
    };

    let mut treasury = Treasury {
        id: object::new(ctx),
        dwallet_cap,
        presigns: vector::empty(),
        members,
        approval_threshold,
        requests: table::new(ctx),
        next_request_id: 0,
        ika_balance: initial_ika.into_balance(),
        sui_balance: initial_sui.into_balance(),
        dwallet_network_encryption_key_id,
    };

    // Pre-fill the presign pool so the first signing request doesn't have to wait
    request_presigns_internal(&mut treasury, coordinator, 2, SECP256K1, ECDSA_SECP256K1, ctx);

    transfer::public_share_object(treasury);
}

// ── Member management ──────────────────────────────────────────────────────────

/// Add IKA tokens to pay for Ika protocol fees (presign/sign operations).
public entry fun fund_ika(self: &mut Treasury, coin: Coin<IKA>) {
    self.ika_balance.join(coin.into_balance());
}

/// Add SUI tokens for the coordinator's gas reimbursement mechanism.
public entry fun fund_sui(self: &mut Treasury, coin: Coin<SUI>) {
    self.sui_balance.join(coin.into_balance());
}

// ── Presign pool management ────────────────────────────────────────────────────

/// Pre-compute `count` signing nonces for future signatures.
///
/// Call this to top up the pool before it empties. Each signature consumes one presign.
/// Presigns can be requested well in advance — they're not message-specific.
///
/// NOTE: This costs IKA + SUI fees for each presign requested.
public entry fun add_presigns(
    self: &mut Treasury,
    coordinator: &mut DWalletCoordinator,
    count: u64,
    ctx: &mut TxContext,
) {
    request_presigns_internal(self, coordinator, count, SECP256K1, ECDSA_SECP256K1, ctx);
}

/// Add Bitcoin Taproot presigns (different signature algorithm).
public entry fun add_taproot_presigns(
    self: &mut Treasury,
    coordinator: &mut DWalletCoordinator,
    count: u64,
    ctx: &mut TxContext,
) {
    request_presigns_internal(self, coordinator, count, SECP256K1, TAPROOT, ctx);
}

// ── Sign request lifecycle ─────────────────────────────────────────────────────

/// Phase 1: Member creates a sign request.
///
/// This calls coordinator.approve_message() and returns the sign request ID.
/// Other members can then vote with vote_on_request().
/// Once `approval_threshold` approvals are reached, execute_request() can be called.
public entry fun create_request(
    self: &mut Treasury,
    coordinator: &mut DWalletCoordinator,
    message: vector<u8>,
    ctx: &mut TxContext,
): u64 {
    assert!(self.members.contains(&ctx.sender()), ENotMember);
    assert!(self.presigns.length() > 0, ENoPresigns);

    // Allocate a presign for this request
    let presign = self.presigns.swap_remove(0);

    let request_id = self.next_request_id;
    self.next_request_id = request_id + 1;

    let mut votes: Table<address, bool> = table::new(ctx);
    // Proposer auto-votes to approve
    table::add(&mut votes, ctx.sender(), true);

    let request = SignRequest {
        id: request_id,
        message,
        partial_presign: option::some(presign),
        votes,
        approvals: 1,
        rejections: 0,
        executed: false,
    };

    table::add(&mut self.requests, request_id, request);

    // Auto-replenish if pool is low
    if (self.presigns.length() < MIN_POOL_SIZE) {
        let (mut ika, mut sui) = withdraw_payment_coins(self, ctx);
        let session = fresh_session(coordinator, ctx);
        self.presigns.push_back(coordinator.request_global_presign(
            self.dwallet_network_encryption_key_id,
            SECP256K1,
            ECDSA_SECP256K1,
            session,
            &mut ika,
            &mut sui,
            ctx,
        ));
        return_payment_coins(self, ika, sui);
    };

    request_id
}

/// Phase 1b: Member casts a vote on an existing sign request.
///
/// Votes are irrevocable — once cast they cannot be changed.
/// When approvals reach the threshold, execute_request() becomes callable.
public entry fun vote_on_request(
    self: &mut Treasury,
    request_id: u64,
    approve: bool,
    ctx: &TxContext,
) {
    assert!(self.members.contains(&ctx.sender()), ENotMember);

    let request = table::borrow_mut(&mut self.requests, request_id);
    assert!(!request.executed, EAlreadyExecuted);
    assert!(!table::contains(&request.votes, ctx.sender()), EAlreadyVoted);

    table::add(&mut request.votes, ctx.sender(), approve);

    if (approve) {
        request.approvals = request.approvals + 1;
    } else {
        request.rejections = request.rejections + 1;
    };
}

/// Phase 2: Execute an approved sign request.
///
/// Can be called by any member once approvals >= threshold.
/// The approve_message() + request_sign_and_return_id() calls happen here.
/// Returns the sign session ID — use it to poll for the signature:
///   ikaClient.getSignInParticularState(signId, Curve.SECP256K1, SignatureAlgorithm.ECDSASecp256k1, 'Completed')
public entry fun execute_request(
    self: &mut Treasury,
    coordinator: &mut DWalletCoordinator,
    request_id: u64,
    ctx: &mut TxContext,
): ID {
    assert!(self.members.contains(&ctx.sender()), ENotMember);

    let request = table::borrow_mut(&mut self.requests, request_id);
    assert!(!request.executed, EAlreadyExecuted);
    assert!(request.approvals >= self.approval_threshold, EInsufficientApprovals);

    let (mut ika, mut sui) = withdraw_payment_coins(self, ctx);

    // Extract and verify the presign allocated during create_request
    let unverified_presign = option::extract(&mut request.partial_presign);
    let verified_presign: VerifiedPresignCap = coordinator.verify_presign_cap(unverified_presign, ctx);

    // approve_message creates a MessageApproval hot-potato (drop-only, no store).
    // It cryptographically binds the DWalletCap to the specific message + algorithm.
    let approval: MessageApproval = coordinator.approve_message(
        &self.dwallet_cap,
        ECDSA_SECP256K1,  // signature algorithm
        SHA256,           // hash scheme
        request.message,
    );

    // Register a unique session identifier to prevent replay attacks.
    // fresh_object_address() gives a deterministic-but-unique address per call.
    let session: SessionIdentifier = fresh_session(coordinator, ctx);

    // Submit the sign request. The Ika network validators asynchronously produce
    // the signature and store it in the returned sign session object.
    let sign_id = coordinator.request_sign_and_return_id(
        verified_presign,
        approval,
        option::none(), // message_centralized_signature (None for standard signing)
        session,
        &mut ika,
        &mut sui,
        ctx,
    );

    request.executed = true;

    return_payment_coins(self, ika, sui);

    sign_id
}

// ── View functions ─────────────────────────────────────────────────────────────

public fun presign_count(self: &Treasury): u64 {
    self.presigns.length()
}

public fun ika_balance(self: &Treasury): u64 {
    self.ika_balance.value()
}

public fun sui_balance(self: &Treasury): u64 {
    self.sui_balance.value()
}

public fun request_approvals(self: &Treasury, request_id: u64): u64 {
    table::borrow(&self.requests, request_id).approvals
}

public fun request_executed(self: &Treasury, request_id: u64): bool {
    table::borrow(&self.requests, request_id).executed
}

public fun dwallet_id(self: &Treasury): ID {
    self.dwallet_cap.dwallet_id()
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/// Withdraw the entire IKA and SUI balances into Coins for passing to coordinator.
/// Always pair with return_payment_coins to avoid burning funds.
fun withdraw_payment_coins(
    self: &mut Treasury,
    ctx: &mut TxContext,
): (Coin<IKA>, Coin<SUI>) {
    let ika = self.ika_balance.withdraw_all().into_coin(ctx);
    let sui = self.sui_balance.withdraw_all().into_coin(ctx);
    (ika, sui)
}

/// Return unused fees back into the treasury balances.
fun return_payment_coins(self: &mut Treasury, ika: Coin<IKA>, sui: Coin<SUI>) {
    self.ika_balance.join(ika.into_balance());
    self.sui_balance.join(sui.into_balance());
}

/// Create a unique SessionIdentifier for this protocol operation.
/// ctx.fresh_object_address() is unique within a transaction, preventing replay.
fun fresh_session(
    coordinator: &mut DWalletCoordinator,
    ctx: &mut TxContext,
): SessionIdentifier {
    coordinator.register_session_identifier(
        ctx.fresh_object_address().to_bytes(),
        ctx,
    )
}

/// Internal helper to batch-request presigns.
fun request_presigns_internal(
    self: &mut Treasury,
    coordinator: &mut DWalletCoordinator,
    count: u64,
    curve_id: u32,
    signature_alg_id: u32,
    ctx: &mut TxContext,
) {
    let (mut ika, mut sui) = withdraw_payment_coins(self, ctx);

    let mut i = 0;
    while (i < count) {
        let session = fresh_session(coordinator, ctx);

        // request_global_presign: use for Taproot, EdDSA, ECDSASecp256k1 (non-imported key).
        // Use request_presign() instead for ECDSA with imported-key dWallets.
        self.presigns.push_back(coordinator.request_global_presign(
            self.dwallet_network_encryption_key_id,
            curve_id,
            signature_alg_id,
            session,
            &mut ika,
            &mut sui,
            ctx,
        ));

        i = i + 1;
    };

    return_payment_coins(self, ika, sui);
}
