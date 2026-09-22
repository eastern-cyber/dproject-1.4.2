// src/app/api/send-ktdfi/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  createThirdwebClient,
  defineChain,
  getContract,
  prepareContractCall,
  sendTransaction,
  readContract,
  toWei,
} from "thirdweb";
import { privateKeyToAccount } from "thirdweb/wallets";
import { polygon } from "thirdweb/chains";

// ============================================================
// CONFIGURATION
// ============================================================

// KTDFI ERC-20 contract on Polygon
const KTDFI_CONTRACT_ADDRESS = "0x532313164FDCA3ACd2C2900455B208145f269f0e";

// Two sender wallets: one for D1 bonuses, one for Plan A membership bonuses
// These are read from SERVER-ONLY env vars (no NEXT_PUBLIC_ prefix).
const KTDFI_SENDERS = {
  d1: {
    privateKey: process.env.KTDFI_SENDER_PRIVATE_KEY_D1,
    expectedAddress: "0x778cE5fB24792B79446Fe02a483C86E527e8C295",
    label: "D1",
  },
  planA: {
    privateKey: process.env.KTDFI_SENDER_PRIVATE_KEY,
    expectedAddress: "0x984395c00E5451437ed47346e6911c2F5CC31ad3",
    label: "PlanA",
  },
} as const;

type SenderKind = keyof typeof KTDFI_SENDERS;

// ============================================================
// TYPES
// ============================================================

interface SendKtdfiRequest {
  /** Which sender wallet to sign with. */
  sender: SenderKind;
  /** Recipient wallet address (0x... 40 hex chars). */
  to: string;
  /** Amount of KTDFI in whole tokens (e.g. "10000"). */
  amount: string;
  /** Optional context for logging only. */
  memo?: string;
}

interface SendKtdfiResponse {
  success: boolean;
  txHash?: string;
  error?: string;
}

// ============================================================
// HELPERS
// ============================================================

const isValidAddress = (addr: string): boolean => {
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) return false;
  // Reject the zero address — ERC-20 contracts always revert on it
  if (addr.toLowerCase() === "0x0000000000000000000000000000000000000000") return false;
  return true;
};

const isValidAmount = (amount: string): boolean => {
  const n = Number(amount);
  return Number.isFinite(n) && n > 0;
};

// ============================================================
// ROUTE HANDLER
// ============================================================

export async function POST(
  request: NextRequest
): Promise<NextResponse<SendKtdfiResponse>> {
  const start = Date.now();

  try {
    // ----- 1. Parse body -----
    let body: SendKtdfiRequest;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const { sender, to, amount, memo } = body;

    // ----- 2. Validate inputs -----
    if (!sender || !(sender in KTDFI_SENDERS)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid sender. Must be one of: ${Object.keys(KTDFI_SENDERS).join(", ")}`,
        },
        { status: 400 }
      );
    }

    if (!to || !isValidAddress(to)) {
      return NextResponse.json(
        { success: false, error: "Invalid recipient address" },
        { status: 400 }
      );
    }

    if (!amount || !isValidAmount(amount)) {
      return NextResponse.json(
        { success: false, error: "Invalid amount" },
        { status: 400 }
      );
    }

    // ----- 3. Load sender config -----
    const senderConfig = KTDFI_SENDERS[sender];

    if (!senderConfig.privateKey) {
      console.error(
        `[send-ktdfi] Missing private key for sender="${sender}". ` +
          `Expected env var: KTDFI_SENDER_PRIVATE_KEY${sender === "d1" ? "_D1" : ""}`
      );
      return NextResponse.json(
        { success: false, error: "Sender wallet not configured" },
        { status: 500 }
      );
    }

    // ----- 4. Initialize client + sender account -----
    // Use a server-only client. If you already have a shared server client, swap this in.
    const serverClient = createThirdwebClient({
      secretKey: process.env.THIRDWEB_SECRET_KEY, // server-only
    });

    const senderAccount = privateKeyToAccount({
      client: serverClient,
      privateKey: senderConfig.privateKey,
    });

    // Sanity: verify the derived address matches expected (protects against env var mixups)
    if (
      senderConfig.expectedAddress &&
      senderAccount.address.toLowerCase() !==
        senderConfig.expectedAddress.toLowerCase()
    ) {
      console.error(
        `[send-ktdfi] Sender address mismatch! ` +
          `Env var produces ${senderAccount.address}, expected ${senderConfig.expectedAddress}`
      );
      return NextResponse.json(
        { success: false, error: "Sender wallet misconfiguration" },
        { status: 500 }
      );
    }

    const chain = defineChain(polygon);

    const ktdfiContract = getContract({
      client: serverClient,
      chain,
      address: KTDFI_CONTRACT_ADDRESS,
    });

    // ----- 5. Check sender has enough KTDFI -----
    const balanceRaw = await readContract({
      contract: ktdfiContract,
      method: {
        type: "function",
        name: "balanceOf",
        inputs: [{ type: "address", name: "owner" }],
        outputs: [{ type: "uint256" }],
        stateMutability: "view",
      },
      params: [senderAccount.address],
    });

    const balanceTokens = Number(balanceRaw) / 10 ** 18;
    const requiredTokens = Number(amount);

    if (balanceTokens < requiredTokens) {
      console.error(
        `[send-ktdfi] Insufficient KTDFI. Sender ${senderConfig.label} ` +
          `(${senderAccount.address}) has ${balanceTokens}, needs ${requiredTokens}`
      );
      return NextResponse.json(
        {
          success: false,
          error: `Insufficient KTDFI in sender wallet. Has ${balanceTokens.toFixed(2)}, needs ${requiredTokens}`,
        },
        { status: 400 }
      );
    }

    // ----- 6. Prepare and send the transfer -----
    const transferCall = prepareContractCall({
      contract: ktdfiContract,
      method: {
        type: "function",
        name: "transfer",
        inputs: [
          { type: "address", name: "to" },
          { type: "uint256", name: "value" },
        ],
        outputs: [{ type: "bool" }],
        stateMutability: "nonpayable",
      },
      params: [to, toWei(amount)],
    });

    const { transactionHash } = await sendTransaction({
      transaction: transferCall,
      account: senderAccount,
    });

    const durationMs = Date.now() - start;
    console.log(
      `[send-ktdfi] ✅ Sent ${amount} KTDFI from ${senderConfig.label} ` +
        `(${senderAccount.address}) to ${to} in ${durationMs}ms. tx=${transactionHash}` +
        (memo ? ` memo="${memo}"` : "")
    );

    return NextResponse.json(
      { success: true, txHash: transactionHash },
      { status: 200 }
    );
  } catch (error: unknown) {
    const err = error as Error;
    const durationMs = Date.now() - start;

    console.error(
      `[send-ktdfi] ❌ Failed after ${durationMs}ms:`,
      err?.message || err,
      err?.stack
    );

    // Extract a human-friendly error
    let message = err?.message || "Unknown error";
    if (message.includes("insufficient funds")) {
      message = "Sender wallet has insufficient POL for gas";
    } else if (message.includes("nonce")) {
      message = "Nonce error — please retry";
    } else if (message.includes("replacement transaction")) {
      message = "Transaction already pending — please retry";
    }

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// Disable Next.js body parsing limits if needed (default is fine here)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";