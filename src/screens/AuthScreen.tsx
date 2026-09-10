import React, { useState } from 'react';
import {
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  ChevronLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Camera,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { BRANDING_CONFIG } from '../config/branding';
import { UserAvatar } from '../components/common/UserAvatar';

export type AuthViewMode = 'login' | 'signup' | 'forgot' | 'reset';

export type PasswordStrength = 'weak' | 'medium' | 'strong';

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function calculatePasswordStrength(password: string): {
  strength: PasswordStrength;
  label: string;
  score: number;
} {
  if (!password || password.length === 0) {
    return { strength: 'weak', label: '', score: 0 };
  }
  if (password.length < 6) {
    return { strength: 'weak', label: 'Too short (min 6)', score: 1 };
  }
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) {
    return { strength: 'weak', label: 'Weak', score: 1 };
  }
  if (score <= 2) {
    return { strength: 'medium', label: 'Medium', score: 2 };
  }
  return { strength: 'strong', label: 'Strong', score: 3 };
}

export const AuthScreen: React.FC = () => {
  const {
    signInWithEmailPassword,
    signUpWithEmail,
    sendPasswordResetEmail,
    updatePassword,
    isPasswordRecovery,
    dismissPasswordRecovery,
    continueAsGuest,
    isConfigured,
  } = useAuth();

  const [mode, setMode] = useState<AuthViewMode>(isPasswordRecovery ? 'reset' : 'login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const resetMessages = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const switchMode = (newMode: AuthViewMode) => {
    resetMessages();
    setMode(newMode);
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setErrorMessage('Image must be under 5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAvatarPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  // 1. Email Sign In
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    if (!email.trim() || !password) {
      setErrorMessage('Please enter both email and password.');
      return;
    }

    setIsLoading(true);
    const { error } = await signInWithEmailPassword(email.trim(), password);
    setIsLoading(false);
    if (error) {
      setErrorMessage(error);
    }
  };

  // 2. Email Sign Up / Create Account
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    if (!displayName.trim()) {
      setErrorMessage('Please enter your name.');
      return;
    }
    if (!email.trim() || !isValidEmail(email)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }

    setIsLoading(true);
    const { error, requiresEmailVerification } = await signUpWithEmail(
      email.trim(),
      password,
      displayName.trim()
    );
    setIsLoading(false);

    if (error) {
      setErrorMessage(error);
    } else if (requiresEmailVerification) {
      setSuccessMessage('A confirmation email has been sent! Please verify your email to sign in.');
      setMode('login');
    }
  };

  // 3. Forgot Password
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    if (!email.trim()) {
      setErrorMessage('Please enter your account email.');
      return;
    }

    setIsLoading(true);
    const { error } = await sendPasswordResetEmail(email.trim());
    setIsLoading(false);

    if (error) {
      setErrorMessage(error);
    } else {
      setSuccessMessage('Password reset link sent! Check your inbox.');
    }
  };

  // 4. Reset Password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    const { error } = await updatePassword(password);
    setIsLoading(false);

    if (error) {
      setErrorMessage(error);
    } else {
      setSuccessMessage('Password successfully updated! You can now sign in.');
      dismissPasswordRecovery();
      setMode('login');
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#0B0B0F] text-stuxs-text flex flex-col justify-between px-6 py-8 relative overflow-x-hidden overflow-y-auto select-none">
      {/* Subtle Ambient Brand Glow */}
      <div className="absolute top-0 inset-x-0 h-96 bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.14),transparent_70%)] pointer-events-none" />
      <div className="absolute -bottom-20 right-0 w-80 h-80 bg-violet-600/5 rounded-full blur-3xl pointer-events-none" />

      {/* Top Header Bar / Back button */}
      <header className="w-full max-w-sm mx-auto z-10 flex items-center justify-between min-h-[40px]">
        {mode === 'forgot' || mode === 'reset' ? (
          <button
            onClick={() => switchMode('login')}
            className="flex items-center gap-1 text-xs font-semibold text-stuxs-text-secondary hover:text-white transition-colors p-2 -ml-2 rounded-xl active:scale-95 cursor-pointer touch-manipulation"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
        ) : (
          <div />
        )}
      </header>

      {/* Main Authentication Container */}
      <main className="w-full max-w-sm mx-auto z-10 my-auto py-4">
        {/* Brand Header */}
        <div className="text-center mb-7">
          <div className="inline-flex items-center justify-center p-2 rounded-2xl bg-white/[0.04] border border-white/[0.08] shadow-lg mb-4">
            <img
              src={BRANDING_CONFIG.appLogo}
              alt="STUXS Music"
              className="w-10 h-10 object-contain rounded-xl"
            />
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-white">
            {mode === 'login' && 'Welcome back'}
            {mode === 'signup' && 'Create your account'}
            {mode === 'forgot' && 'Reset password'}
            {mode === 'reset' && 'Set new password'}
          </h1>
          <p className="text-xs text-stuxs-text-secondary font-medium tracking-wide mt-1">
            {mode === 'login' && 'Sign in to continue your music.'}
            {mode === 'signup' && 'Start building your music world.'}
            {mode === 'forgot' && 'Enter your email to receive a recovery link.'}
            {mode === 'reset' && 'Create a secure password for your account.'}
          </p>
        </div>

        {/* Global Error Banner */}
        {errorMessage && (
          <div className="mb-4 p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs font-medium flex items-start gap-2.5 animate-in fade-in zoom-in-95 duration-150">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            <span className="leading-snug">{errorMessage}</span>
          </div>
        )}

        {/* Global Success Banner */}
        {successMessage && (
          <div className="mb-4 p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs font-medium flex items-start gap-2.5 animate-in fade-in zoom-in-95 duration-150">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <span className="leading-snug">{successMessage}</span>
          </div>
        )}

        {/* --- VIEW 1: SIGN IN (LOGIN) --- */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4 animate-in fade-in zoom-in-[0.98] duration-200">
            <div className="space-y-3">
              {/* Email Input */}
              <div className="relative flex items-center h-13 px-3.5 rounded-2xl bg-[#15151C] border border-white/[0.08] focus-within:border-violet-500/70 focus-within:ring-1 focus-within:ring-violet-500/30 transition-all duration-150">
                <Mail className="w-4 h-4 text-stuxs-text-muted flex-shrink-0 mr-3 pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  autoComplete="email"
                  autoFocus
                  enterKeyHint="next"
                  required
                  className="w-full bg-transparent text-sm text-white placeholder-stuxs-text-muted focus:outline-none"
                />
              </div>

              {/* Password Input */}
              <div className="relative flex items-center h-13 px-3.5 rounded-2xl bg-[#15151C] border border-white/[0.08] focus-within:border-violet-500/70 focus-within:ring-1 focus-within:ring-violet-500/30 transition-all duration-150">
                <Lock className="w-4 h-4 text-stuxs-text-muted flex-shrink-0 mr-3 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                  enterKeyHint="done"
                  required
                  className="w-full bg-transparent text-sm text-white placeholder-stuxs-text-muted focus:outline-none pr-8"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 p-1.5 text-stuxs-text-muted hover:text-white transition-colors cursor-pointer touch-manipulation"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Forgot Password Link */}
            <div className="flex justify-end pt-0.5">
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="text-xs font-semibold text-stuxs-text-secondary hover:text-violet-300 transition-colors cursor-pointer touch-manipulation"
              >
                Forgot password?
              </button>
            </div>

            {/* Primary Sign In Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-13 rounded-2xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 active:scale-[0.98] text-white font-bold text-sm shadow-[0_4px_20px_rgba(139,92,246,0.3)] transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 touch-manipulation"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Signing in...</span>
                </>
              ) : (
                <span>Sign In</span>
              )}
            </button>

            {/* Switch to Create Account */}
            <div className="pt-3 text-center">
              <p className="text-xs text-stuxs-text-secondary font-medium">
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className="font-bold text-violet-400 hover:text-violet-300 transition-colors cursor-pointer ml-1 touch-manipulation"
                >
                  Create Account
                </button>
              </p>
            </div>

            {/* Instant Guest / Skip Link */}
            <div className="pt-5 border-t border-white/[0.06] text-center">
              <button
                type="button"
                onClick={continueAsGuest}
                className="text-xs font-semibold text-stuxs-text-muted hover:text-white transition-colors cursor-pointer touch-manipulation inline-flex items-center gap-1.5"
              >
                <span>Continue as Guest</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        )}

        {/* --- VIEW 2: CREATE ACCOUNT (SIGN UP) --- */}
        {mode === 'signup' && (
          <form onSubmit={handleSignUp} className="space-y-4 animate-in fade-in zoom-in-[0.98] duration-200">
            {/* Optional Avatar Preview & Custom Upload */}
            <div className="flex flex-col items-center justify-center pb-2">
              <div className="relative group cursor-pointer">
                <UserAvatar
                  name={displayName || 'User'}
                  avatarUrl={avatarPreview}
                  size="xl"
                  className="ring-2 ring-violet-500/40 shadow-xl"
                />
                <label className="absolute -bottom-1 -right-1 p-2 rounded-full bg-violet-600 hover:bg-violet-500 text-white shadow-md cursor-pointer active:scale-95 transition-all border border-black/40">
                  <Camera className="w-3.5 h-3.5" />
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarChange}
                    className="hidden"
                  />
                </label>
              </div>
              <span className="text-[11px] text-stuxs-text-muted font-medium mt-2">
                {avatarPreview ? 'Custom photo added' : 'Avatar generated from name'}
              </span>
            </div>

            <div className="space-y-3">
              {/* Display Name Input */}
              <div className="relative flex items-center h-13 px-3.5 rounded-2xl bg-[#15151C] border border-white/[0.08] focus-within:border-violet-500/70 focus-within:ring-1 focus-within:ring-violet-500/30 transition-all duration-150">
                <User className="w-4 h-4 text-stuxs-text-muted flex-shrink-0 mr-3 pointer-events-none" />
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Display name"
                  autoComplete="name"
                  autoFocus
                  enterKeyHint="next"
                  required
                  className="w-full bg-transparent text-sm text-white placeholder-stuxs-text-muted focus:outline-none"
                />
              </div>

              {/* Email Input */}
              <div className="relative flex items-center h-13 px-3.5 rounded-2xl bg-[#15151C] border border-white/[0.08] focus-within:border-violet-500/70 focus-within:ring-1 focus-within:ring-violet-500/30 transition-all duration-150">
                <Mail className="w-4 h-4 text-stuxs-text-muted flex-shrink-0 mr-3 pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  autoComplete="email"
                  enterKeyHint="next"
                  required
                  className="w-full bg-transparent text-sm text-white placeholder-stuxs-text-muted focus:outline-none"
                />
              </div>

              {/* Password Input */}
              <div className="relative flex items-center h-13 px-3.5 rounded-2xl bg-[#15151C] border border-white/[0.08] focus-within:border-violet-500/70 focus-within:ring-1 focus-within:ring-violet-500/30 transition-all duration-150">
                <Lock className="w-4 h-4 text-stuxs-text-muted flex-shrink-0 mr-3 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password (min. 6 characters)"
                  autoComplete="new-password"
                  enterKeyHint="done"
                  required
                  minLength={6}
                  className="w-full bg-transparent text-sm text-white placeholder-stuxs-text-muted focus:outline-none pr-8"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 p-1.5 text-stuxs-text-muted hover:text-white transition-colors cursor-pointer touch-manipulation"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {/* Lightweight Password Strength Indicator */}
              {password.length > 0 && (() => {
                const strength = calculatePasswordStrength(password);
                return (
                  <div className="pt-0.5 px-1">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] text-stuxs-text-muted">Password strength:</span>
                      <span
                        className={`text-[11px] font-semibold ${
                          strength.strength === 'strong'
                            ? 'text-emerald-400'
                            : strength.strength === 'medium'
                            ? 'text-amber-400'
                            : 'text-rose-400'
                        }`}
                      >
                        {strength.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 h-1 w-full">
                      <div
                        className={`rounded-full transition-colors duration-200 ${
                          strength.score >= 1
                            ? strength.strength === 'strong'
                              ? 'bg-emerald-500'
                              : strength.strength === 'medium'
                              ? 'bg-amber-500'
                              : 'bg-rose-500'
                            : 'bg-white/10'
                        }`}
                      />
                      <div
                        className={`rounded-full transition-colors duration-200 ${
                          strength.score >= 2
                            ? strength.strength === 'strong'
                              ? 'bg-emerald-500'
                              : 'bg-amber-500'
                            : 'bg-white/10'
                        }`}
                      />
                      <div
                        className={`rounded-full transition-colors duration-200 ${
                          strength.score >= 3 ? 'bg-emerald-500' : 'bg-white/10'
                        }`}
                      />
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Primary Create Account Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-13 rounded-2xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 active:scale-[0.98] text-white font-bold text-sm shadow-[0_4px_20px_rgba(139,92,246,0.3)] transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 touch-manipulation"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Creating account...</span>
                </>
              ) : (
                <span>Create Account</span>
              )}
            </button>

            {/* Switch to Sign In */}
            <div className="pt-3 text-center">
              <p className="text-xs text-stuxs-text-secondary font-medium">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="font-bold text-violet-400 hover:text-violet-300 transition-colors cursor-pointer ml-1 touch-manipulation"
                >
                  Sign In
                </button>
              </p>
            </div>

            {/* Instant Guest / Skip Link */}
            <div className="pt-5 border-t border-white/[0.06] text-center">
              <button
                type="button"
                onClick={continueAsGuest}
                className="text-xs font-semibold text-stuxs-text-muted hover:text-white transition-colors cursor-pointer touch-manipulation inline-flex items-center gap-1.5"
              >
                <span>Continue as Guest</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        )}

        {/* --- VIEW 3: FORGOT PASSWORD --- */}
        {mode === 'forgot' && (
          <form onSubmit={handleForgotPassword} className="space-y-4 animate-in fade-in zoom-in-[0.98] duration-200">
            <div className="relative flex items-center h-13 px-3.5 rounded-2xl bg-[#15151C] border border-white/[0.08] focus-within:border-violet-500/70 focus-within:ring-1 focus-within:ring-violet-500/30 transition-all duration-150">
              <Mail className="w-4 h-4 text-stuxs-text-muted flex-shrink-0 mr-3 pointer-events-none" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                autoComplete="email"
                autoFocus
                enterKeyHint="done"
                required
                className="w-full bg-transparent text-sm text-white placeholder-stuxs-text-muted focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-13 rounded-2xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 active:scale-[0.98] text-white font-bold text-sm shadow-[0_4px_20px_rgba(139,92,246,0.3)] transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 touch-manipulation"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Sending link...</span>
                </>
              ) : (
                <span>Send Reset Link</span>
              )}
            </button>

            <div className="pt-3 text-center">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="text-xs font-semibold text-violet-400 hover:text-violet-300 transition-colors cursor-pointer touch-manipulation"
              >
                Back to Sign In
              </button>
            </div>
          </form>
        )}

        {/* --- VIEW 4: RESET PASSWORD --- */}
        {mode === 'reset' && (
          <form onSubmit={handleResetPassword} className="space-y-4 animate-in fade-in zoom-in-[0.98] duration-200">
            <div className="space-y-3">
              <div className="relative flex items-center h-13 px-3.5 rounded-2xl bg-[#15151C] border border-white/[0.08] focus-within:border-violet-500/70 focus-within:ring-1 focus-within:ring-violet-500/30 transition-all duration-150">
                <Lock className="w-4 h-4 text-stuxs-text-muted flex-shrink-0 mr-3 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="New password (min. 6 characters)"
                  autoFocus
                  enterKeyHint="next"
                  required
                  minLength={6}
                  className="w-full bg-transparent text-sm text-white placeholder-stuxs-text-muted focus:outline-none pr-8"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 p-1.5 text-stuxs-text-muted hover:text-white transition-colors cursor-pointer touch-manipulation"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <div className="relative flex items-center h-13 px-3.5 rounded-2xl bg-[#15151C] border border-white/[0.08] focus-within:border-violet-500/70 focus-within:ring-1 focus-within:ring-violet-500/30 transition-all duration-150">
                <Lock className="w-4 h-4 text-stuxs-text-muted flex-shrink-0 mr-3 pointer-events-none" />
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  enterKeyHint="done"
                  required
                  minLength={6}
                  className="w-full bg-transparent text-sm text-white placeholder-stuxs-text-muted focus:outline-none pr-8"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3.5 p-1.5 text-stuxs-text-muted hover:text-white transition-colors cursor-pointer touch-manipulation"
                  aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-13 rounded-2xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 active:scale-[0.98] text-white font-bold text-sm shadow-[0_4px_20px_rgba(139,92,246,0.3)] transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 touch-manipulation"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Updating...</span>
                </>
              ) : (
                <span>Update Password</span>
              )}
            </button>
          </form>
        )}

        {!isConfigured && (
          <div className="mt-6 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300/90 text-[11px] text-center">
            <span className="font-semibold">Setup Notice:</span> Add <code className="text-amber-200">VITE_SUPABASE_URL</code> & <code className="text-amber-200">VITE_SUPABASE_ANON_KEY</code> in <code className="text-amber-200">.env</code>.
          </div>
        )}
      </main>

      {/* Footer Terms */}
      <footer className="w-full max-w-sm mx-auto text-center text-[11px] text-stuxs-text-muted/70 z-10">
        By continuing, you agree to STUXS Terms & Privacy Policy.
      </footer>
    </div>
  );
};
