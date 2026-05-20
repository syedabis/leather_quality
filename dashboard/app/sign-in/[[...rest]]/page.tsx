"use client";
import { useAuth, useSignIn, useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FiAlertCircle } from 'react-icons/fi';
import { Eye, EyeOff } from 'lucide-react';

export default function SignIn() {
  const { isSignedIn, isLoaded } = useAuth();
  const router = useRouter();

  // Redirect to /overview if already signed in
  useEffect(() => {
    if (isLoaded && isSignedIn) {
      router.replace('/overview');
    }
  }, [isLoaded, isSignedIn, router]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { signIn } = useSignIn() as any;
  const { setActive } = useClerk();

  const [identifier, setIdentifier] = useState('');
  const [password,   setPassword]   = useState('');
  const [showPw,     setShowPw]     = useState(false);
  const [submitErr,  setSubmitErr]  = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signIn) return;
    setSubmitErr(null);
    setIsFetching(true);

    try {
      const result = await signIn.create({ strategy: 'password', identifier, password });
      const status    = result?.status    ?? signIn.status;
      const sessionId = result?.createdSessionId ?? signIn.createdSessionId;

      if (status === 'complete') {
        await setActive({ session: sessionId });
        router.push('/overview');
      } else if (status === 'needs_second_factor') {
        setSubmitErr('Two-factor authentication is required. Please disable MFA in Clerk dashboard.');
      } else {
        setSubmitErr(`Sign-in failed (status: ${status}). Check credentials and try again.`);
      }
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clerkErr = (err as any)?.errors?.[0];
      setSubmitErr(clerkErr?.longMessage || clerkErr?.message || (err as Error).message || 'Sign-in failed. Please try again.');
    } finally {
      setIsFetching(false);
    }
  };

  const errorMsg: string | null = submitErr;

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 md:p-6 lg:p-8 relative overflow-hidden bg-gray-900">

      {/* Background texture */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/bg_1920.webp"
        alt=""
        className="absolute inset-0 w-full h-full object-cover opacity-60 pointer-events-none select-none"
        aria-hidden="true"
      />

      {/* Card */}
      <div className="relative z-10 w-full max-w-md bg-white rounded-3xl shadow-2xl p-6">

        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-1">
          <div className="flex flex-col items-center select-none">
            <span
              className="text-3xl font-black tracking-[0.15em] text-[#8B4513] uppercase"
              style={{ fontFamily: 'Georgia, serif' }}
            >
              DADA
            </span>
            <span className="text-[9px] text-[#A0522D] tracking-[0.3em] uppercase font-semibold">
              BESPOKE CONCEPTS
            </span>
          </div>
        </div>

        {/* Welcome text */}
        <div className="text-center w-full mb-6">
          <h1 className="text-3xl font-extrabold text-gray-900 mb-2 leading-tight">Welcome back</h1>
          <p className="text-gray-500 text-xs md:text-sm leading-relaxed max-w-md mx-auto">
            Log in to access your Spray Plant Operations dashboard and stay updated with real-time data and performance metrics.
          </p>
        </div>

        {/* Error banner */}
        {errorMsg && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl">
            <FiAlertCircle className="text-red-500 w-4 h-4 flex-shrink-0" />
            <p className="text-sm text-red-600">{errorMsg}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <input
            type="text"
            placeholder="Email"
            value={identifier}
            onChange={e => setIdentifier(e.target.value)}
            className="w-full h-11 bg-gray-50 border border-gray-200 focus:bg-white focus:border-gray-400
              rounded-lg px-4 text-gray-900 text-sm placeholder-gray-400
              focus:outline-none focus:ring-0 transition-colors"
            autoComplete="username"
            required
          />

          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full h-11 bg-gray-50 border border-gray-200 focus:bg-white focus:border-gray-400
                rounded-lg px-4 pr-10 text-gray-900 text-sm placeholder-gray-400
                focus:outline-none focus:ring-0 transition-colors"
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              onClick={() => setShowPw(v => !v)}
              tabIndex={-1}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <TextureButton disabled={isFetching}>
            {isFetching ? 'Signing in…' : 'Sign In'}
          </TextureButton>

        </form>
      </div>
    </div>
  );
}

// ── Shared texture button ─────────────────────────────────────────────────────

function TextureButton({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full mt-2 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold
        py-3.5 px-4 rounded-lg transition-all shadow-lg hover:shadow-xl
        transform hover:scale-[1.02] active:scale-[0.98]
        disabled:transform-none disabled:hover:scale-100
        flex items-center justify-center relative overflow-hidden cursor-pointer"
      style={{
        backgroundImage: 'url(/images/button2.webp)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <div className="absolute inset-0 bg-black/60 hover:bg-black/50 active:bg-black/70 transition-colors rounded-lg pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent pointer-events-none rounded-lg" />
      <span className="text-lg relative z-10 flex items-center gap-2">
        {disabled && (
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {children}
      </span>
    </button>
  );
}
