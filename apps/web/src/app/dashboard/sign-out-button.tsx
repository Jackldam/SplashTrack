"use client";

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { authClient } from '@/lib/auth-client';

export function SignOutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleSignOut() {
    setIsPending(true);

    const result = await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push('/login');
          router.refresh();
        },
      },
    });

    if (result?.error) {
      setIsPending(false);
      return;
    }
  }

  return (
    <button className="button" disabled={isPending} onClick={handleSignOut} type="button">
      {isPending ? 'Bezig...' : 'Sign out'}
    </button>
  );
}
