// components/DailyCheckin.js
import { useMemo, useState, useEffect } from 'react';
import {
  useAccount,
  useChainId,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { toast } from 'react-hot-toast'; // Import toast

// --- CONFIGURATION (UNCHANGED) ---
// Address of the deployed contract
const CHECKIN_ADDRESS =
  process.env.NEXT_PUBLIC_CHECKIN_ADDRESS || '0xfE482b020d5B3f87b72b493f2d7EDddcAC123613';

// Minimal ABI of the BaseDailyCheckin contract
const ABI = [
  { type: 'function', name: 'checkIn', stateMutability: 'nonpayable', inputs: [{ name: 'note', type: 'string' }], outputs: [{ name: 'day', type: 'uint256' }, { name: 'streak', type: 'uint256' }, { name: 'userTotal', type: 'uint256' }] },
  { type: 'function', name: 'getUser', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: 'lastDay', type: 'uint64' }, { name: 'streak', type: 'uint32' }, { name: 'total', type: 'uint32' }] },
  { type: 'function', name: 'canCheckIn', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'currentDay', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalCheckins', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];

// --- CACHING LOGIC ---
// Unique key prefix for local storage cache
const CACHE_KEY_PREFIX = 'base-lite:onchain-checkin:v1:';

export default function DailyCheckin() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const onBase = chainId === 8453 || chainId === 84532;

  // --- LOCAL STATE FOR CACHED DATA ---
  const [cachedState, setCachedState] = useState({ streak: 0, canCheckIn: null });
  const cacheKey = useMemo(() => (address ? `${CACHE_KEY_PREFIX}${address.toLowerCase()}` : null), [address]);

  // Load initial state from cache
  useEffect(() => {
    if (cacheKey) {
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (typeof parsed.streak === 'number' && typeof parsed.canCheckIn === 'boolean') {
            setCachedState(parsed);
          }
        }
      } catch (e) {
        console.error('Failed to read check-in state from cache.', e);
      }
    }
  }, [cacheKey]);

  // --- WAGMI HOOKS FOR ON-CHAIN INTERACTION ---
  const contractConfig = useMemo(
    () => (CHECKIN_ADDRESS && onBase ? { address: CHECKIN_ADDRESS, abi: ABI, chainId } : null),
    [onBase, chainId]
  );

  const { data: canDoResult, refetch: refetchCanDo } = useReadContract({
    ...contractConfig,
    functionName: 'canCheckIn',
    args: address ? [address] : undefined,
    query: { enabled: !!(contractConfig && isConnected && address) },
  });

  const { data: userDataResult, refetch: refetchUser } = useReadContract({
    ...contractConfig,
    functionName: 'getUser',
    args: address ? [address] : undefined,
    query: { enabled: !!(contractConfig && isConnected && address) },
  });

  const { data: hash, isPending, writeContract } = useWriteContract();
  const { isLoading: isMining, isSuccess } = useWaitForTransactionReceipt({ hash });

  // --- CACHE AND STATE SYNCHRONIZATION ---
  useEffect(() => {
    if (userDataResult !== undefined && canDoResult !== undefined) {
      const newState = {
        streak: Number(userDataResult[1] ?? 0),
        canCheckIn: canDoResult,
      };
      setCachedState(newState);
      if (cacheKey) {
        localStorage.setItem(cacheKey, JSON.stringify(newState));
      }
    }
  }, [userDataResult, canDoResult, cacheKey]);
  
  // --- TRANSACTION FEEDBACK ---
  useEffect(() => {
    if (isPending) {
      toast.loading('Check your wallet to confirm...', { id: 'checkin-tx' });
    }
    if (isMining) {
      toast.loading('Transaction is confirming...', { id: 'checkin-tx' });
    }
    if (isSuccess) {
      toast.success('Check-in successful!', { id: 'checkin-tx' });
      // After a successful transaction, refetch the on-chain data to get the latest state.
      setTimeout(() => {
        refetchUser();
        refetchCanDo();
      }, 1500);
    }
  }, [isPending, isMining, isSuccess, refetchUser, refetchCanDo]);


  // --- EVENT HANDLER ---
  const handleCheckIn = () => {
    if (!contractConfig) return;
    writeContract(
      { ...contractConfig, functionName: 'checkIn', args: [''] },
      { 
        onError: (e) => {
          // Provide a user-friendly error toast
          toast.error(e.shortMessage || 'Transaction failed. Please try again.', { id: 'checkin-tx' });
          console.error('Failed to send transaction:', e);
        }
      }
    );
  };

  // --- RENDER LOGIC ---
  const streak = userDataResult !== undefined ? Number(userDataResult[1]) : cachedState.streak;
  const canDo = canDoResult !== undefined ? canDoResult : cachedState.canCheckIn;

  const disabled = !isConnected || !onBase || !contractConfig || isPending || isMining || canDo === false;
  const label =
    !isConnected ? 'Connect your wallet'
    : !onBase ? 'Switch to Base / Base Sepolia'
    : isPending ? 'Check wallet...'
    : isMining ? 'Confirming...'
    : canDo === false ? 'Already checked-in today'
    : 'Daily check-in';

  if (!CHECKIN_ADDRESS) {
    return (
      <div style={{ marginTop: 10, fontSize: 14, opacity: 0.95 }}>
        <strong>Daily check-in</strong>
        <br />
        <span style={{ opacity: 0.8 }}>
          Contract address not configured. Set <code>NEXT_PUBLIC_CHECKIN_ADDRESS</code>.
        </span>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Daily check-in</div>
      
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 8 }}>
        <button
          onClick={handleCheckIn}
          disabled={disabled}
          style={{
            height: 36,
            padding: '0 14px',
            borderRadius: 12,
            border: '1px solid rgba(0,0,0,0.14)',
            background: disabled ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.12)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontWeight: 700,
          }}
          title={label}
          aria-label="Daily check-in"
        >
          {label}
        </button>
      </div>

      {isConnected && onBase && (
        <div style={{ fontSize: 14, opacity: 0.95 }}>
          Streak: <strong>{streak}</strong>
          {canDo === false && <span> — come back tomorrow! ✅</span>}
        </div>
      )}
    </div>
  );
}```

---

### File 3: `components/CreatorBuilderScore.js`

This component is now enhanced to show a loading toast while fetching scores and will show either a success or a user-friendly error toast when the API call completes.

```javascript
// components/CreatorBuilderScore.js
import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { toast } from 'react-hot-toast'; // Import toast

export default function CreatorBuilderScore() {
  const { address, isConnected } = useAccount();
  const [scores, setScores] = useState({ creator: null, builder: null });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isConnected || !address) {
      setScores({ creator: null, builder: null });
      return;
    }

    const fetchScores = async () => {
      setLoading(true);
      const loadingToast = toast.loading('Fetching Builder Scores...'); // Show loading toast
      try {
        // Talent Protocol Production API Endpoint
        const response = await fetch(`https://api.talentprotocol.com/api/v2/builder-score/${address}`);
        if (!response.ok) {
          throw new Error('Could not fetch scores. The wallet may not have a score yet.');
        }
        const data = await response.json();
        setScores({
          creator: data.score?.creator_score || 0,
          builder: data.score?.score || 0,
        });
        toast.success('Scores loaded!', { id: loadingToast }); // Update to success
      } catch (err) {
        // Display a more helpful error message in a toast
        toast.error(
          <span>
            Could not load scores. You may need to create a{' '}
            <a href="https://app.talentprotocol.com/" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', color: 'inherit' }}>
              Talent Protocol
            </a>{' '}
            profile.
          </span>,
          { id: loadingToast }
        );
        setScores({ creator: 0, builder: 0 }); // Reset to 0 on error
      } finally {
        setLoading(false);
      }
    };

    fetchScores();
  }, [address, isConnected]);

  if (!isConnected) {
    return null; // Don't show anything if wallet is not connected
  }
  
  // A simple loading text can still be useful for initial state
  if (loading && scores.creator === null) {
      return <div style={{ fontSize: 14, opacity: 0.8, marginTop: 8 }}>Loading scores...</div>;
  }
  
  // Don't render until we have a score (or a failed state with score 0)
  if (scores.creator === null && scores.builder === null) {
    return null;
  }

  return (
    <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center', gap: '20px', fontSize: 14 }}>
      <div>
        Creator Score: <strong>{scores.creator}</strong>
      </div>
      <div>
        Builder Score: <strong>{scores.builder}</strong>
      </div>
    </div>
  );
}
