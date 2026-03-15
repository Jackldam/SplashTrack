"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { authClient } from '@/lib/auth-client';

type LoginFormProps = {
  redirectTo?: string;
};

export function LoginForm({ redirectTo = '/dashboard' }: LoginFormProps) {
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
      setErrorMessage(result.error.message ?? 'Inloggen is niet gelukt.');
      return;
    }

    router.push(redirectTo);
    router.refresh();
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label className="field">
        <span>E-mail</span>
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
        <span>Wachtwoord</span>
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
        {isPending ? 'Bezig...' : 'Inloggen'}
      </button>

      <Link className="text-link" href="/">
        Terug naar home
      </Link>
    </form>
  );
}
