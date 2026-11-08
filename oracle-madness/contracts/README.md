# Oracle Madness · Pyth Entropy v2 contract (stub)

`OracleMadnessEntropy.sol` is the on-chain replacement for the in-browser
"Simulated Entropy" module. It uses Pyth Entropy v2 (`getFeeV2()` + `requestV2()`
and an `entropyCallback`) for two things:

| Function | When the app calls it | What the callback stores |
|---|---|---|
| `requestSeeding(tournamentId)` | Before the bracket is shown | `seedingRandom[tournamentId]`, event `SeedingDrawn` |
| `requestSuddenDeath(tournamentId, matchId)` | A match is still inside the confidence shield after overtime | `suddenDeathWinner[...]` = 1 (side A, even) or 2 (side B, odd), event `SuddenDeathResolved` |

The web app uses exactly the same rules (`shuffle(assets, random)` for seeds,
even → side A for sudden death), so swapping the module is a drop-in change.

**Status:** compiles with solc 0.8.24 against `@pythnetwork/entropy-sdk-solidity`
(ABI in `OracleMadnessEntropy.abi.json`). **Not deployed, not audited.** Testnet only.

## Deploy to Base Sepolia (when you're ready)

Facts checked on-chain on 2026-10-18 (always re-check https://docs.pyth.network/entropy/chainlist):

- Entropy contract on Base Sepolia: `0x41c9e39574F40Ad34c79f1C99B66A45eFB830d4c`
- Default provider it reports: `0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344`
- `getFeeV2()` returned ~0.000015 ETH (testnet ETH, free from a faucet)

### Option A: Remix (no installs, easiest from Cursor)
1. Open https://remix.ethereum.org, create `OracleMadnessEntropy.sol`, paste the file.
2. Remix resolves `@pythnetwork/entropy-sdk-solidity/...` imports from npm automatically.
3. Compiler 0.8.24+, then **Deploy & Run** → environment "Injected Provider" (MetaMask on Base Sepolia).
4. Constructor arg: `0x41c9e39574F40Ad34c79f1C99B66A45eFB830d4c`.
5. Call `fee()`, then `requestSeeding(1)` with that value (in wei) as msg.value.
6. Watch the `SeedingDrawn` event, or look the request up at https://entropy-explorer.pyth.network/.

### Option B: Foundry
```bash
forge init om-contracts && cd om-contracts
npm i @pythnetwork/entropy-sdk-solidity
echo '@pythnetwork/entropy-sdk-solidity/=node_modules/@pythnetwork/entropy-sdk-solidity' > remappings.txt
cp ../contracts/OracleMadnessEntropy.sol src/
forge create src/OracleMadnessEntropy.sol:OracleMadnessEntropy \
  --rpc-url https://sepolia.base.org --account <your-keystore> --broadcast \
  --constructor-args 0x41c9e39574F40Ad34c79f1C99B66A45eFB830d4c
# request seeding (fee from `cast call <addr> "fee()(uint256)"`)
cast send <addr> "requestSeeding(uint64)" 1 --value <fee> --rpc-url https://sepolia.base.org --account <your-keystore>
```

## Wiring it into the web app (next step)
`js/entropy.js` already has an `OnchainEntropy` placeholder with the same
`request(purpose)` interface. Implement it with viem/ethers from a CDN:
1. `fee()` → `requestSeeding` / `requestSuddenDeath` with the connected wallet.
2. Read the sequence number from `RandomnessRequested`.
3. Poll for `SeedingDrawn` / `SuddenDeathResolved` with that sequence number.
4. Return `{ seq, random, explorer: "https://entropy-explorer.pyth.network/..." }`.

Notes: the callback never reverts (as Entropy requires); fees must be read on-chain,
never hard-coded; only the organiser can request, so viewers can't spam requests.
