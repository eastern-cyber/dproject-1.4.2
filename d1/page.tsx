// src/app/d1/page.tsx
"use client";
import React, { useEffect, useState } from 'react'
import Image from "next/image";
import { useActiveAccount } from "thirdweb/react";
import dprojectIcon from "@public/DProjectLogo_650x600.svg";
import Link from 'next/link';
import WalletConnect from '@/components/WalletConnect';
import Footer from '@/components/Footer';
import { defineChain, getContract, toWei, sendTransaction, readContract } from "thirdweb";
import { polygon } from "thirdweb/chains";
import { client } from "@/lib/client";
import { useRouter } from 'next/navigation';
import { ConfirmModal } from '@/components/confirmModal';
// 🔄 CHANGED: Removed `privateKeyToAccount` import — no longer needed client-side
// 🔄 CHANGED: Removed `prepareContractCall` import — KTDFI txs are now handled server-side

// ===== ADD THESE CONSTANTS =====
const KTDFI_SENDER_ADDRESS = "0x778cE5fB24792B79446Fe02a483C86E527e8C295";
const KTDFI_CONTRACT_ADDRESS = "0x532313164FDCA3ACd2C2900455B208145f269f0e";
const KTDFI_AMOUNT_D1_MEMBER = "10000"; // 10,000 KTDFI tokens for D1 member
const KTDFI_AMOUNT_D1_REFERRER = "10000"; // 10,000 KTDFI tokens for referrer bonus
// 🔄 CHANGED: Removed `KTDFI_SENDER_PRIVATE_KEY` client reference — the private key
//              now lives ONLY on the server (env var `KTDFI_SENDER_PRIVATE_KEY_D1`,
//              no NEXT_PUBLIC_ prefix), used by /api/send-ktdfi.

// Constants
const RECIPIENT_ADDRESS = "0x3B16949e2fec02E1f9A2557cE7FEBe74f780fADc";
const MEMBERSHIP_FEE_THB = 800;
const MINIMUM_PAYMENT = 0.01; // Minimum POL to pay for transaction

// GitHub Raw URL for exchange rate configuration (same as other pages)
const GITHUB_CONFIG_URL = "https://raw.githubusercontent.com/eastern-cyber/dproject-admin-1.0.2/main/public/exchange-rate-config.json";

// Default values in case GitHub fetch fails
const DEFAULT_CONFIG = {
  fallbackExchangeRate: 3.2,
  exchangeRateBuffer: 0,
  refreshInterval: 300000 // 5 minutes
};

// Interfaces
interface UserData {
  id: number;
  user_id: string;
  referrer_id: string | null;
  email: string | null;
  name: string | null;
  token_id: string | null;
  plan_a: any | null;
  created_at: string;
  updated_at: string;
}

// Update the D1Data interface
interface D1Data {
  id: number;
  user_id: string;
  rate_thb_pol: number | string;
  append_pol: number | string;
  used_bonus_pol: number | string;
  append_pol_tx_hash: string | null;
  append_pol_date_time: string | null;
  remark: any | null;
  created_at: string;
  updated_at: string;
  d1_id: string | null;
  d1_sequence: number | null;
}

interface BonusData {
  id: number;
  user_id: string;
  pr: number;
  cr: number;
  rt: number;
  ar: number;
  bonus_date: string;
  calculated_at: string;
  created_at: string;
  updated_at: string;
}

// Update TransactionStatus interface
type TransactionStatus = {
  firstTransaction: boolean;
  secondTransaction: boolean;
  thirdTransaction: boolean;
  fourthTransaction: boolean;
  error?: string;
};

// Configuration type for exchange rate settings
type ExchangeRateConfig = {
  fallbackExchangeRate: number;
  exchangeRateBuffer: number;
  refreshInterval: number;
};

// 🔄 CHANGED: Sender kind type matching /api/send-ktdfi
type SenderKind = "d1" | "planA";

// 🔄 CHANGED: Response shape from /api/send-ktdfi
interface SendKtdfiApiResponse {
  success: boolean;
  txHash?: string;
  error?: string;
}

export default function PlanB() {
  const account = useActiveAccount();
  const router = useRouter();
  
  // State variables
  const [userData, setUserData] = useState<UserData | null>(null);
  const [allD1Data, setAllD1Data] = useState<D1Data[]>([]);
  const [bonusData, setBonusData] = useState<BonusData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Transaction states
  const [isTransactionComplete, setIsTransactionComplete] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<TransactionStatus>({
    firstTransaction: false,
    secondTransaction: false,
    thirdTransaction: false,
    fourthTransaction: false
  });
  
  // Modal states
  const [showFirstConfirmationModal, setShowFirstConfirmationModal] = useState(false);
  const [showSecondConfirmationModal, setShowSecondConfirmationModal] = useState(false);
  const [showThirdConfirmationModal, setShowThirdConfirmationModal] = useState(false);
  const [showFourthConfirmationModal, setShowFourthConfirmationModal] = useState(false);
  const [isProcessingFirst, setIsProcessingFirst] = useState(false);
  const [isProcessingSecond, setIsProcessingSecond] = useState(false);
  const [isProcessingThird, setIsProcessingThird] = useState(false);
  const [isProcessingFourth, setIsProcessingFourth] = useState(false);

  // Data states
  const [firstTxHash, setFirstTxHash] = useState<string>("");
  const [secondTxHash, setSecondTxHash] = useState<string>("");
  const [thirdTxHash, setThirdTxHash] = useState<string>("");
  const [fourthTxHash, setFourthTxHash] = useState<string>("");
  const [polBalance, setPolBalance] = useState<string>("0");
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [adjustedExchangeRate, setAdjustedExchangeRate] = useState<number | null>(null);
  const [rateLoading, setRateLoading] = useState(true);
  const [transactionError, setTransactionError] = useState<string | null>(null);
  const [exchangeRateConfig, setExchangeRateConfig] = useState<ExchangeRateConfig>(DEFAULT_CONFIG);

  // 🔄 CHANGED: Removed `ktdfiSenderAccount` state — no longer initialized client-side.
  //              The server route handles signing.
  //              Added a readiness flag that reflects whether the server env vars are set.
  //              We optimistically assume the server is ready; failures surface at call time.
  const [ktdfiSenderReady, setKtdfiSenderReady] = useState<boolean>(true);

  // D1 Details Modal States
  const [showD1DetailsModal, setShowD1DetailsModal] = useState(false);
  const [currentD1Page, setCurrentD1Page] = useState(1);
  const [recordsPerPage] = useState(5);
  const [expandedD1Id, setExpandedD1Id] = useState<number | null>(null);

  // Success Modal States
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successData, setSuccessData] = useState<{
    sequence: number;
    d1Id: string;
  } | null>(null);

  // Debug logging
  useEffect(() => {
    console.log("Component state:", {
      account: account?.address,
      userData: !!userData,
      allD1DataCount: allD1Data.length,
      exchangeRate,
      adjustedExchangeRate,
      polBalance,
      loading,
      rateLoading
    });
  }, [account, userData, allD1Data, exchangeRate, adjustedExchangeRate, polBalance, loading, rateLoading]);

  useEffect(() => {
    console.log("Account changed:", account?.address);
  }, [account?.address]);

  // Fetch exchange rate configuration from GitHub
  useEffect(() => {
    const fetchExchangeRateConfig = async () => {
      try {
        setRateLoading(true);
        const response = await fetch(GITHUB_CONFIG_URL, {
          cache: 'no-store',
          headers: {
            'Accept': 'application/json',
          }
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch config: ${response.status}`);
        }

        const config: ExchangeRateConfig = await response.json();
        
        const validatedConfig = {
          fallbackExchangeRate: config.fallbackExchangeRate > 0 ? config.fallbackExchangeRate : DEFAULT_CONFIG.fallbackExchangeRate,
          exchangeRateBuffer: config.exchangeRateBuffer >= 0 ? config.exchangeRateBuffer : DEFAULT_CONFIG.exchangeRateBuffer,
          refreshInterval: config.refreshInterval > 0 ? config.refreshInterval : DEFAULT_CONFIG.refreshInterval
        };

        setExchangeRateConfig(validatedConfig);
        console.log('Exchange rate config loaded:', validatedConfig);
      } catch (error) {
        console.error('Failed to load exchange rate config from GitHub, using defaults:', error);
        setExchangeRateConfig(DEFAULT_CONFIG);
        setError("ไม่สามารถโหลดอัตราแลกเปลี่ยนจากระบบกลาง กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต");
      }
    };

    fetchExchangeRateConfig();
  }, []);

  // Update exchange rate based on config
  useEffect(() => {
    const updateExchangeRate = async () => {
      try {
        setRateLoading(true);
        const currentRate = exchangeRateConfig.fallbackExchangeRate;
        const adjustedRate = Math.max(0.01, currentRate - exchangeRateConfig.exchangeRateBuffer);
        
        setExchangeRate(currentRate);
        setAdjustedExchangeRate(adjustedRate);
        
        console.log(`Exchange rate updated: ${currentRate} THB/POL (adjusted: ${adjustedRate})`);
      } catch (err) {
        console.error("Failed to get exchange rate:", err);
        const fallbackAdjustedRate = Math.max(
          0.01, 
          exchangeRateConfig.fallbackExchangeRate - exchangeRateConfig.exchangeRateBuffer
        );
        setExchangeRate(exchangeRateConfig.fallbackExchangeRate);
        setAdjustedExchangeRate(fallbackAdjustedRate);
        setError("ใช้อัตราแลกเปลี่ยนจากระบบกลาง เนื่องจากไม่สามารถโหลดอัตราปัจจุบันได้");
      } finally {
        setRateLoading(false);
      }
    };

    if (exchangeRateConfig) {
      updateExchangeRate();
      
      const interval = setInterval(updateExchangeRate, exchangeRateConfig.refreshInterval);
      return () => clearInterval(interval);
    }
  }, [exchangeRateConfig]);

  // Fetch user data and all D1 records
  useEffect(() => {
    const fetchUserData = async () => {
      if (!account?.address) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        
        // Fetch user data
        const userResponse = await fetch(`/api/users?user_id=${account.address}`);
        
        if (!userResponse.ok) {
          const errorData = await userResponse.json();
          if (errorData.error === 'User not found') {
            setError('ไม่พบข้อมูลผู้ใช้');
            return;
          }
          throw new Error(errorData.error || `HTTP error! status: ${userResponse.status}`);
        }

        const userData = await userResponse.json();
        setUserData(userData);

        // Fetch ALL D1 records for the user
        try {
          const d1Response = await fetch(`/api/d1?user_id=${account.address}&all=true`);
          if (d1Response.ok) {
            const d1DataArray = await d1Response.json();
            
            if (Array.isArray(d1DataArray) && d1DataArray.length > 0) {
              // Sort by d1_sequence in descending order (newest first)
              const sortedD1Data = d1DataArray.sort((a: D1Data, b: D1Data) => 
                (b.d1_sequence || 0) - (a.d1_sequence || 0)
              );
              
              setAllD1Data(sortedD1Data);
            } else {
              setAllD1Data([]);
            }
          } else {
            setAllD1Data([]);
          }
        } catch (d1Error) {
          console.log('Error fetching D1 data:', d1Error);
          setAllD1Data([]);
        }

      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
        setError(errorMessage);
        console.error('Error fetching user data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, [account?.address]);

  // Fetch bonus data when user data is loaded
  useEffect(() => {
    if (userData) {
      console.log("Fetching bonus data for user:", userData.user_id);
      fetchBonusData();
    }
  }, [userData]);

  // Fetch POL balance
  useEffect(() => {
    const fetchBalance = async () => {
      if (!account) {
        setPolBalance("0");
        return;
      }
      
      try {
        const balanceResult = await readContract({
          contract: getContract({
            client,
            chain: defineChain(polygon),
            address: "0x0000000000000000000000000000000000001010"  // ✅ CORRECT ADDRESS
          }),
          method: {
            type: "function",
            name: "balanceOf",
            inputs: [{ type: "address", name: "owner" }],
            outputs: [{ type: "uint256" }],
            stateMutability: "view"
          },
          params: [account.address]
        });

        const balanceInPOL = Number(balanceResult) / 10**18;
        setPolBalance(balanceInPOL.toFixed(4));
      } catch (err) {
        console.error("Error fetching POL balance:", err);
        setPolBalance("0");
      }
    };

    if (account) {
      fetchBalance();
    }
  }, [account]);

  // 🔄 CHANGED: Removed the entire useEffect that initialized `ktdfiSenderAccount`.
  //              The server route handles private key loading. Nothing to init here.
  //
  //              If you want a lightweight readiness probe, you can optionally ping
  //              the API with a HEAD/GET later. For now we assume it's ready and
  //              surface any real errors at call time.

  // Handle ESC key for modal
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && showD1DetailsModal) {
        setShowD1DetailsModal(false);
      }
    };

    window.addEventListener('keydown', handleEscKey);
    
    return () => {
      window.removeEventListener('keydown', handleEscKey);
    };
  }, [showD1DetailsModal]);

  // Helper functions
  const calculateRemainingBonus = () => {
    if (!bonusData.length) return 0;
    
    const totalBonus = bonusData.reduce((total, bonus) => total + 
      (Number(bonus.pr) || 0) + 
      (Number(bonus.cr) || 0) + 
      (Number(bonus.rt) || 0) + 
      (Number(bonus.ar) || 0), 0);
    
    const netBonus = totalBonus * 0.05;
    
    // Calculate total used bonus from all D1 records
    const totalUsedBonus = allD1Data.reduce((sum, d1) => 
      sum + (Number(d1.used_bonus_pol) || 0), 0
    );
    
    // Return remaining bonus (can't be negative)
    return Math.max(0, netBonus - totalUsedBonus);
  };

  const calculateRequiredPolAmount = () => {
    if (!adjustedExchangeRate) return null;
    
    const requiredPolFor800THB = MEMBERSHIP_FEE_THB / adjustedExchangeRate;
    const remainingBonus = calculateRemainingBonus();
    
    // If remaining bonus covers the full amount, pay only minimum
    if (remainingBonus >= requiredPolFor800THB) {
      return MINIMUM_PAYMENT;
    }
    
    // Otherwise, pay the difference
    return Math.max(MINIMUM_PAYMENT, requiredPolFor800THB - remainingBonus);
  };

  const calculateBonusToUse = () => {
    if (!adjustedExchangeRate) return 0;
    
    const requiredPolFor800THB = MEMBERSHIP_FEE_THB / adjustedExchangeRate;
    const remainingBonus = calculateRemainingBonus();
    
    if (remainingBonus >= requiredPolFor800THB) {
      return requiredPolFor800THB;
    }
    
    return remainingBonus;
  };

  // Transaction execution
  const executeTransaction = async (to: string, amountWei: bigint) => {
    try {
      console.log("Preparing transaction:", {
        to,
        amountWei: amountWei.toString(),
        amountPOL: (Number(amountWei) / 10**18).toString()
      });

      if (!isValidEthereumAddress(to)) {
        return { 
          success: false, 
          error: `Invalid recipient address: ${to}` 
        };
      }

      if (!account) {
        return {
          success: false,
          error: "No wallet connected"
        };
      }

      const transaction = {
        to: to as `0x${string}`,
        value: amountWei,
        chain: defineChain(polygon),
        client,
      };

      console.log("Sending transaction:", transaction);

      const { transactionHash } = await sendTransaction({
        transaction,
        account: account
      });

      console.log("Transaction successful, hash:", transactionHash);
      return { success: true, transactionHash };
    } catch (error: any) {
      console.error("Transaction failed with detailed error:", error);
      
      let errorMessage = error.message || "Unknown error";
      
      if (errorMessage.includes("user rejected") || errorMessage.includes("denied transaction")) {
        errorMessage = "User rejected the transaction";
      } else if (errorMessage.includes("insufficient funds")) {
        errorMessage = "Insufficient funds for transaction";
      } else if (errorMessage.includes("gas")) {
        errorMessage = "Gas estimation failed - please try again";
      } else if (errorMessage.includes("network") || errorMessage.includes("chain")) {
        errorMessage = "Network error - please check your connection";
      } else if (errorMessage.includes("Unexpected error") || errorMessage.includes("Ue")) {
        errorMessage = "Transaction failed - please check your wallet balance and try again";
      }
      
      return { success: false, error: errorMessage };
    }
  };

  const checkWalletBalance = async (requiredAmount: number): Promise<{ sufficient: boolean; balance: string; required: string; error?: string }> => {
  if (!account) {
    return {
      sufficient: false,
      balance: "0",
      required: requiredAmount.toString(),
      error: "No wallet connected"
    };
  }

  try {
    const balanceResult = await readContract({
      contract: getContract({
        client,
        chain: defineChain(polygon),
        address: "0x0000000000000000000000000000000000001010"  // ✅ CORRECT ADDRESS
      }),
      method: {
        type: "function",
        name: "balanceOf",
        inputs: [{ type: "address", name: "owner" }],
        outputs: [{ type: "uint256" }],
        stateMutability: "view"
      },
      params: [account.address]
    });

    const balanceInPOL = Number(balanceResult) / 10**18;
    const sufficient = balanceInPOL >= requiredAmount;

    return {
      sufficient,
      balance: balanceInPOL.toFixed(4),
      required: requiredAmount.toFixed(4)
    };
  } catch (err) {
    console.error("Error checking wallet balance:", err);
    return {
      sufficient: false,
      balance: "0",
      required: requiredAmount.toString(),
      error: "Failed to check balance"
    };
  }
};

  // Database operation
  const addD1ToDatabase = async (d1Data: any) => {
    try {
      console.log('Sending to D1 API:', d1Data);

      const response = await fetch('/api/d1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(d1Data),
      });

      const responseText = await response.text();
      console.log('D1 API response status:', response.status);
      console.log('D1 API response text:', responseText);

      if (!response.ok) {
        let errorData;
        try {
          errorData = JSON.parse(responseText);
        } catch {
          errorData = { error: responseText };
        }
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      return JSON.parse(responseText);
    } catch (error) {
      console.error('Error adding D1 to database:', error);
      throw error;
    }
  };

  // First Transaction
  const handleFirstTransaction = async () => {
    if (!account || !adjustedExchangeRate || !userData) {
      setTransactionError("กรุณาเชื่อมต่อกระเป๋าและรอการโหลดข้อมูล");
      return;
    }
    
    setIsProcessingFirst(true);
    setTransactionError(null);

    try {
      const requiredPolAmount = calculateRequiredPolAmount();
      if (requiredPolAmount === null) {
        throw new Error("ไม่สามารถคำนวณจำนวน POL ที่ต้องการได้");
      }

      console.log("Calculated required POL amount:", requiredPolAmount);

      const balanceCheck = await checkWalletBalance(requiredPolAmount);
      if (!balanceCheck.sufficient) {
        throw new Error(`ยอดเงินในกระเป๋าไม่เพียงพอ\nคุณมี: ${balanceCheck.balance} POL\nต้องการ: ${balanceCheck.required} POL`);
      }

      const requiredAmountWei = toWei(requiredPolAmount.toString());
      console.log("Amount in wei:", requiredAmountWei.toString());

      console.log("Executing transaction to:", RECIPIENT_ADDRESS);
      const firstTransaction = await executeTransaction(RECIPIENT_ADDRESS, requiredAmountWei);
      
      if (!firstTransaction.success) {
        let errorMessage = firstTransaction.error;
        if (errorMessage.includes("insufficient funds")) {
          errorMessage = `ยอดเงินไม่เพียงพอ\nคุณมี: ${balanceCheck.balance} POL\nต้องการ: ${balanceCheck.required} POL`;
        } else if (errorMessage.includes("user rejected")) {
          errorMessage = "คุณได้ปฏิเสธการทำรายการ";
        } else if (errorMessage.includes("gas")) {
          errorMessage = "เกิดข้อผิดพลาดในการคำนวณค่าธรรมเนียม กรุณาลองใหม่อีกครั้ง";
        }
        
        throw new Error(`การทำรายการครั้งที่ 1 ล้มเหลว: ${errorMessage}`);
      }
      
      setFirstTxHash(firstTransaction.transactionHash!);
      setTransactionStatus(prev => ({ ...prev, firstTransaction: true }));
      
      setShowFirstConfirmationModal(false);
      setShowSecondConfirmationModal(true);

    } catch (err) {
      console.error("First transaction failed with details:", err);
      setTransactionError(`การทำรายการล้มเหลว: ${(err as Error).message}`);
    } finally {
      setIsProcessingFirst(false);
    }
  };

  // Second Transaction
  const handleSecondTransaction = async () => {
    if (!account || !adjustedExchangeRate || !userData || !firstTxHash) return;
    
    setIsProcessingSecond(true);
    setTransactionError(null);

    try {
      const referrerAddress = getValidReferrerAddress();
      let secondTransactionHash = "";

      if (referrerAddress) {
        const minimumAmountWei = toWei(MINIMUM_PAYMENT.toString());
        const secondTransaction = await executeTransaction(referrerAddress, minimumAmountWei);
        
        if (!secondTransaction.success) {
          console.warn('Second transaction failed, but continuing:', secondTransaction.error);
        } else {
          secondTransactionHash = secondTransaction.transactionHash!;
          setSecondTxHash(secondTransactionHash);
          setTransactionStatus(prev => ({ ...prev, secondTransaction: true }));
        }
      }

      setShowSecondConfirmationModal(false);
      setShowThirdConfirmationModal(true);

    } catch (err) {
      console.error("Second transaction failed:", err);
      setTransactionError(`การทำรายการล้มเหลว: ${(err as Error).message}`);
    } finally {
      setIsProcessingSecond(false);
    }
  };

  // Third Transaction (KTDFI to member)
  const handleThirdTransaction = async () => {
    // 🔄 CHANGED: no longer checks `ktdfiSenderAccount` — we just need `account` and `firstTxHash`
    if (!account || !firstTxHash) return;
    
    setIsProcessingThird(true);
    setTransactionError(null);

    try {
      let thirdTransactionHash = "";

      // 🔄 CHANGED: Call the server API instead of signing client-side
      const thirdTransaction = await executeKTDFITransactionViaApi(
        "d1",                                        // sender: D1 wallet
        account.address,                             // recipient: the member
        KTDFI_AMOUNT_D1_MEMBER,                      // 10,000 KTDFI
        `D1 member bonus for ${account.address}`     // memo for server logs
      );
      
      if (!thirdTransaction.success) {
        console.warn('KTDFI transaction to member failed:', thirdTransaction.error);
        setTransactionError(`การส่งเหรียญ KTDFI ให้สมาชิกล้มเหลว: ${thirdTransaction.error}. จะดำเนินการต่อไป`);
      } else {
        thirdTransactionHash = thirdTransaction.transactionHash!;
        setThirdTxHash(thirdTransactionHash);
        setTransactionStatus(prev => ({ ...prev, thirdTransaction: true }));
      }

      setShowThirdConfirmationModal(false);
      
      const referrerAddress = getValidReferrerAddress();
      if (referrerAddress) {
        setShowFourthConfirmationModal(true);
      } else {
        await handleDatabaseUpdate(thirdTransactionHash, "");
      }

    } catch (err) {
      console.error("Third transaction failed:", err);
      setTransactionError(`การทำรายการล้มเหลว: ${(err as Error).message}`);
    } finally {
      setIsProcessingThird(false);
    }
  };
  
  // Fourth Transaction (KTDFI to referrer)
  const handleFourthTransaction = async () => {
    // 🔄 CHANGED: no longer checks `ktdfiSenderAccount`
    if (!account) return;
    
    setIsProcessingFourth(true);
    setTransactionError(null);

    try {
      const referrerAddress = getValidReferrerAddress();
      let fourthTransactionHash = "";
      let fourthTransactionError = "";

      if (referrerAddress) {
        // 🔄 CHANGED: Call the server API instead of signing client-side
        const fourthTransaction = await executeKTDFITransactionViaApi(
          "d1",
          referrerAddress,
          KTDFI_AMOUNT_D1_REFERRER,
          `D1 referrer bonus for ${referrerAddress}`
        );
        
        if (!fourthTransaction.success) {
          fourthTransactionError = fourthTransaction.error || "Unknown error";
          console.warn('KTDFI transaction to referrer failed:', fourthTransactionError);
          setTransactionError(`การส่งเหรียญ KTDFI ให้ผู้แนะนำล้มเหลว: ${fourthTransactionError}. แต่จะบันทึกข้อมูลลงฐานข้อมูล`);
        } else {
          fourthTransactionHash = fourthTransaction.transactionHash!;
          setFourthTxHash(fourthTransactionHash);
          setTransactionStatus(prev => ({ ...prev, fourthTransaction: true }));
        }
      }

      await handleDatabaseUpdate(thirdTxHash, fourthTransactionHash);

    } catch (err) {
      console.error("Fourth transaction failed:", err);
      setTransactionError(`การทำรายการล้มเหลว: ${(err as Error).message}`);
    } finally {
      setIsProcessingFourth(false);
    }
  };

  // Database Update for new D1 record
  const handleDatabaseUpdate = async (memberKtdfiTxHash: string, referrerKtdfiTxHash: string) => {
    if (!account || !adjustedExchangeRate) return;

    try {
      const now = new Date();
      const formattedDate = now.toISOString();

      const referrerAddress = getValidReferrerAddress();
      
      // Calculate next sequence number
      const nextSequence = allD1Data.length + 1;
      
      // Generate new D1 ID
      const newD1Id = `D1-${account.address.slice(2, 8).toUpperCase()}-${String(nextSequence).padStart(3, '0')}`;
      
      // Calculate bonus to use for this transaction
      const bonusToUse = calculateBonusToUse();
      const requiredPolAmount = calculateRequiredPolAmount() || 0;
      const requiredPolFor800THB = MEMBERSHIP_FEE_THB / adjustedExchangeRate;
      
      let actualPaid = requiredPolAmount;
      
      if (bonusToUse >= requiredPolFor800THB) {
        actualPaid = MINIMUM_PAYMENT;
      } else {
        actualPaid = Math.max(MINIMUM_PAYMENT, requiredPolFor800THB - bonusToUse);
      }

      // Calculate total used bonus (cumulative)
      const totalUsedBonusCumulative = allD1Data.reduce((sum, d1) => 
        sum + (Number(d1.used_bonus_pol) || 0), 0
      ) + bonusToUse;

      // Prepare D1 data
      const newD1Data = {
        user_id: account.address,
        rate_thb_pol: parseFloat(adjustedExchangeRate.toFixed(4)),
        append_pol: parseFloat(actualPaid.toFixed(4)),
        used_bonus_pol: parseFloat(bonusToUse.toFixed(4)),
        append_pol_tx_hash: firstTxHash,
        append_pol_date_time: formattedDate,
        d1_id: newD1Id,
        d1_sequence: nextSequence,
        remark: {
          net_bonus_used: bonusToUse,
          total_bonus_used_cumulative: totalUsedBonusCumulative,
          referrer_transaction: referrerAddress ? {
            amount: MINIMUM_PAYMENT,
            tx_hash: secondTxHash,
            date_time: formattedDate
          } : null,
          ktdfi_to_member: memberKtdfiTxHash ? {
            amount: KTDFI_AMOUNT_D1_MEMBER,
            tx_hash: memberKtdfiTxHash,
            date_time: formattedDate,
            sender: KTDFI_SENDER_ADDRESS,
            type: "member_bonus"
          } : null,
          ktdfi_to_referrer: referrerAddress && referrerKtdfiTxHash ? {
            amount: KTDFI_AMOUNT_D1_REFERRER,
            tx_hash: referrerKtdfiTxHash,
            date_time: formattedDate,
            sender: KTDFI_SENDER_ADDRESS,
            recipient: referrerAddress,
            type: "referrer_bonus"
          } : referrerAddress && !referrerKtdfiTxHash ? {
            amount: KTDFI_AMOUNT_D1_REFERRER,
            tx_hash: null,
            date_time: formattedDate,
            sender: KTDFI_SENDER_ADDRESS,
            recipient: referrerAddress,
            type: "referrer_bonus_failed",
            error: transactionError || "Transaction failed"
          } : null,
          total_amount_thb: MEMBERSHIP_FEE_THB,
          config_source: GITHUB_CONFIG_URL,
          exchange_rate_buffer: exchangeRateConfig.exchangeRateBuffer,
          timestamp: formattedDate,
          d1_count: nextSequence
        }
      };

      console.log('Adding D1 data to database...');
      const dbResult = await addD1ToDatabase(newD1Data);
      
      if (dbResult && dbResult.user_id) {
        // Refresh D1 data
        const d1Response = await fetch(`/api/d1?user_id=${account.address}&all=true`);
        if (d1Response.ok) {
          const updatedD1Data = await d1Response.json();
          const sortedD1Data = updatedD1Data.sort((a: D1Data, b: D1Data) => 
            (b.d1_sequence || 0) - (a.d1_sequence || 0)
          );
          setAllD1Data(sortedD1Data);
        }
        
        setIsTransactionComplete(true);
        setShowFourthConfirmationModal(false);
        
        // ✅ Show success modal instead of alert
        setSuccessData({
          sequence: nextSequence,
          d1Id: newD1Id
        });
        setShowSuccessModal(true);
        
      } else {
        throw new Error('Failed to save to database');
      }

    } catch (err) {
      console.error("Database update failed:", err);
      setTransactionError(`การบันทึกข้อมูลล้มเหลว: ${(err as Error).message}`);
    }
  };

  // Modal close handlers
  const handleCloseFirstModal = () => {
    if (transactionStatus.firstTransaction) return;
    setShowFirstConfirmationModal(false);
    setTransactionError(null);
  };

  const handleCloseSecondModal = () => {
    if (transactionStatus.secondTransaction) return;
    setShowSecondConfirmationModal(false);
    setTransactionError(null);
  };

  const handleCloseThirdModal = () => {
    if (transactionStatus.thirdTransaction) return;
    setShowThirdConfirmationModal(false);
    setTransactionError(null);
  };

  const handleCloseFourthModal = () => {
    if (transactionStatus.fourthTransaction) return;
    setShowFourthConfirmationModal(false);
    setTransactionError(null);
  };

  // Add this function near your other modal handlers
  const handleCloseSuccessModal = () => {
    setShowSuccessModal(false);
    setSuccessData(null);
    
    // Optionally redirect to user page or refresh data
    if (account) {
      // Refresh user data
      const fetchData = async () => {
        try {
          const d1Response = await fetch(`/api/d1?user_id=${account.address}&all=true`);
          if (d1Response.ok) {
            const updatedD1Data = await d1Response.json();
            const sortedD1Data = updatedD1Data.sort((a: D1Data, b: D1Data) => 
              (b.d1_sequence || 0) - (a.d1_sequence || 0)
            );
            setAllD1Data(sortedD1Data);
          }
        } catch (error) {
          console.error('Error refreshing data:', error);
        }
      };
      fetchData();
    }
  };

  // ============================================================
  // 🔄 CHANGED: New API-based KTDFI transfer helper.
  //             Replaces the old client-side `executeKTDFITransaction`.
  //             The private key never leaves the server.
  // ============================================================
  const executeKTDFITransactionViaApi = async (
    sender: SenderKind,
    to: string,
    amount: string,
    memo?: string
  ): Promise<{ success: boolean; transactionHash?: string; error?: string }> => {
    try {
      console.log(`[client] Requesting KTDFI transfer: sender=${sender}, to=${to}, amount=${amount}`);

      const response = await fetch("/api/send-ktdfi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender, to, amount, memo }),
      });

      let json: SendKtdfiApiResponse;
      try {
        json = await response.json();
      } catch {
        return {
          success: false,
          error: `Server returned non-JSON response (HTTP ${response.status})`,
        };
      }

      if (!response.ok || !json.success || !json.txHash) {
        const message = json.error || `HTTP ${response.status}`;
        console.error(`[client] KTDFI transfer failed:`, message);
        return { success: false, error: message };
      }

      console.log(`[client] KTDFI transfer succeeded: ${json.txHash}`);
      return { success: true, transactionHash: json.txHash };
    } catch (error) {
      console.error("[client]
