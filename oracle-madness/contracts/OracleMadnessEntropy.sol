// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@pythnetwork/entropy-sdk-solidity/IEntropyV2.sol";
import "@pythnetwork/entropy-sdk-solidity/IEntropyConsumer.sol";

/// @title Oracle Madness: Pyth Entropy v2 randomness for bracket seeding and sudden death
/// @notice Minimal stub. The organiser requests randomness; Pyth Entropy delivers it to
///         entropyCallback(). The web app reads the events and uses the random value
///         exactly like the in-browser simulated module does today.
/// @dev    Not audited. Testnet only (e.g. Base Sepolia). Callback never reverts.
contract OracleMadnessEntropy is IEntropyConsumer {
    enum Purpose { None, Seeding, SuddenDeath }

    struct Request {
        Purpose purpose;
        uint64 tournamentId;
        uint32 matchId;      // only for SuddenDeath
        bool fulfilled;
        bytes32 randomNumber;
    }

    IEntropyV2 public immutable entropy;
    address public organizer;

    mapping(uint64 => Request) public requests;           // Entropy sequence number => request
    mapping(uint64 => bytes32) public seedingRandom;       // tournamentId => random used to shuffle seeds
    mapping(bytes32 => uint8) public suddenDeathWinner;    // keccak(tournamentId, matchId) => 1 (side A) or 2 (side B)

    event RandomnessRequested(uint64 indexed sequenceNumber, Purpose purpose, uint64 indexed tournamentId, uint32 matchId);
    event SeedingDrawn(uint64 indexed tournamentId, uint64 sequenceNumber, bytes32 randomNumber);
    event SuddenDeathResolved(uint64 indexed tournamentId, uint32 indexed matchId, uint64 sequenceNumber, bytes32 randomNumber, uint8 winnerSide);

    error NotOrganizer();
    error InsufficientFee(uint256 required);

    modifier onlyOrganizer() {
        if (msg.sender != organizer) revert NotOrganizer();
        _;
    }

    /// @param entropyAddress Pyth Entropy contract for the chain
    ///        (Base Sepolia: 0x41c9e39574F40Ad34c79f1C99B66A45eFB830d4c, checked on-chain 2026-10-18;
    ///        always confirm at https://docs.pyth.network/entropy/chainlist)
    constructor(address entropyAddress) {
        entropy = IEntropyV2(entropyAddress);
        organizer = msg.sender;
    }

    function setOrganizer(address next) external onlyOrganizer {
        organizer = next;
    }

    /// @notice Current fee in native gas token. Call this (off-chain) and send it as msg.value.
    function fee() public view returns (uint256) {
        return entropy.getFeeV2();
    }

    /// @notice Ask Entropy for the random number that shuffles the bracket seeds.
    function requestSeeding(uint64 tournamentId) external payable onlyOrganizer returns (uint64 seq) {
        seq = _request(Purpose.Seeding, tournamentId, 0);
    }

    /// @notice Ask Entropy to settle a match that stayed inside the confidence shield after overtime.
    function requestSuddenDeath(uint64 tournamentId, uint32 matchId) external payable onlyOrganizer returns (uint64 seq) {
        seq = _request(Purpose.SuddenDeath, tournamentId, matchId);
    }

    function _request(Purpose purpose, uint64 tournamentId, uint32 matchId) internal returns (uint64 seq) {
        uint256 f = entropy.getFeeV2();
        if (msg.value < f) revert InsufficientFee(f);
        seq = entropy.requestV2{value: f}();
        requests[seq] = Request(purpose, tournamentId, matchId, false, bytes32(0));
        emit RandomnessRequested(seq, purpose, tournamentId, matchId);
        // refund any overpayment
        if (msg.value > f) {
            (bool ok, ) = payable(msg.sender).call{value: msg.value - f}("");
            ok; // ignore failure; dust stays in the contract
        }
    }

    /// @dev Called by Entropy (via IEntropyConsumer._entropyCallback). Must never revert.
    function entropyCallback(uint64 sequenceNumber, address, bytes32 randomNumber) internal override {
        Request storage r = requests[sequenceNumber];
        if (r.purpose == Purpose.None || r.fulfilled) return;
        r.fulfilled = true;
        r.randomNumber = randomNumber;
        if (r.purpose == Purpose.Seeding) {
            seedingRandom[r.tournamentId] = randomNumber;
            emit SeedingDrawn(r.tournamentId, sequenceNumber, randomNumber);
        } else {
            // Same rule as the web app: even => side A, odd => side B
            uint8 side = uint256(randomNumber) % 2 == 0 ? 1 : 2;
            suddenDeathWinner[keccak256(abi.encode(r.tournamentId, r.matchId))] = side;
            emit SuddenDeathResolved(r.tournamentId, r.matchId, sequenceNumber, randomNumber, side);
        }
    }

    function getEntropy() internal view override returns (address) {
        return address(entropy);
    }
}
