"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { authClient } from '@/lib/auth-client';

type LoginFormCopy = {
  email: string;
  password: string;
  submit: string;
  pending: string;
  backHome: string;
  failed: string;
};

type LoginFormProps = {
  copy: LoginFormCopy;
  redirectTo?: string;
};

export function LoginForm({ copy, redirectTo = '/dashboard' }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsPending(true);

    const result = await authClient.signIn.email({
      email,
      password,
      callbackURL: redirectTo,
    });

    setIsPending(false);

    if (result.error) {
      setErrorMessage(result.error.message ?? copy.failed);
      return;
    }

    router.push(redirectTo);
    router.refresh();
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label className="field">
        <span>{copy.email}</span>
        <input
          autoComplete="email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>

      <label className="field">
        <span>{copy.password}</span>
        <input
          autoComplete="current-password"
          minLength={8}
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>

      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

      <button className="button" disabled={isPending} type="submit">
        {isPending ? copy.pending : copy.submit}
      </button>

      <Link className="text-link" href="/">
        {copy.backHome}
      </Link>
    </form>
  );
}
