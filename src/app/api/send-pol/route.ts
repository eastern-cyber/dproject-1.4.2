// src/app/api/send-pol/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  createThirdwebClient,
  defineChain,
  sendTransaction,
  toWei,
  readContract,
  getContract,
} from "thirdweb";
import { privateKeyToAccount } from "thirdweb/wallets";
import { polygon } from "thirdweb/chains";

// ============================================================
// CONFIGURATION
// ============================================================

const POL_SENDERS = {
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

type SenderKind = keyof typeof POL_SENDERS;

// ============================================================
// TYPES
// ============================================================

interface SendPolRequest {
  sender: SenderKind;
  to: string;
  amount: string;
  memo?: string;
}

interface SendPolResponse {
  success: boolean;
  txHash?: string;
  error?: string;
}

// ============================================================
// HELPERS
// ============================================================

const isValidAddress = (addr: string): boolean => {
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) return false;
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
): Promise<NextResponse<SendPolResponse>> {
  const start = Date.now();

  try {
    // 1. Parse body
    let body: SendPolRequest;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const { sender, to, amount, memo } = body;

    // 2. Validate inputs
    if (!sender || !(sender in POL_SENDERS)) {
      return NextResponse.json(
        { success: false, error: "Invalid sender" },
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

    // 3. Load sender config
    const senderConfig = POL_SENDERS[sender];
    if (!senderConfig.privateKey) {
      console.error(`[send-pol] Missing private key for sender="${sender}"`);
      return NextResponse.json(
        { success: false, error: "Sender wallet not configured" },
        { status: 500 }
      );
    }

    // 4. Initialize client + sender
    const serverClient = createThirdwebClient({
      secretKey: process.env.THIRDWEB_SECRET_KEY,
    });

    const senderAccount = privateKeyToAccount({
      client: serverClient,
      privateKey: senderConfig.privateKey,
    });

    if (
      senderAccount.address.toLowerCase() !==
      senderConfig.expectedAddress.toLowerCase()
    ) {
      console.error(
        `[send-pol] Sender address mismatch: got ${senderAccount.address}, expected ${senderConfig.expectedAddress}`
      );
      return NextResponse.json(
        { success: false, error: "Sender wallet misconfiguration" },
        { status: 500 }
      );
    }

    const chain = defineChain(polygon);

    // 5. Check sender has enough POL (amount + gas buffer)
    const gasBuffer = 0.5;
    const balanceResult = await readContract({
      contract: getContract({
        client: serverClient,
        chain,
        address: "0x0000000000000000000000000000000000001010",
      }),
      method: {
        type: "function",
        name: "balanceOf",
        inputs: [{ type: "address", name: "owner" }],
        outputs: [{ type: "uint256" }],
        stateMutability: "view",
      },
      params: [senderAccount.address],
    });

    const balancePol = Number(balanceResult) / 10 ** 18;
    const requiredPol = Number(amount) + gasBuffer;

    if (balancePol < requiredPol) {
      console.error(
        `[send-pol] Insufficient POL. ${senderConfig.label} wallet has ${balancePol.toFixed(4)} POL, needs ${requiredPol.toFixed(4)} POL`
      );
      return NextResponse.json(
        {
          success: false,
          error: `Sender wallet has insufficient POL. Has ${balancePol.toFixed(4)}, needs ${requiredPol.toFixed(4)}`,
        },
        { status: 400 }
      );
    }

    // 6. Send the transaction
    const { transactionHash } = await sendTransaction({
      transaction: {
        to: to as `0x${string}`,
        value: toWei(amount),
        chain,
        client: serverClient,
      },
      account: senderAccount,
    });

    const durationMs = Date.now() - start;
    console.log(
      `[send-pol] ✅ Sent ${amount} POL from ${senderConfig.label} ` +
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
      `[send-pol] ❌ Failed after ${durationMs}ms:`,
      err?.message || err
    );

    let message = err?.message || "Unknown error";
    if (message.includes("insufficient funds")) {
      message = "Sender wallet has insufficient POL for gas";
    } else if (message.includes("nonce")) {
      message = "Nonce error — please retry";
    }

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";