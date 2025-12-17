import type { Metadata } from 'next';
import ProfilePageClient from './ProfilePageClient';

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params;
  return {
    title: `@${username} - Token Usage`,
    description: `View ${username}'s AI token usage statistics and cost breakdown`,
    openGraph: {
      title: `@${username}'s Token Usage`,
      description: `AI token usage statistics for ${username}`,
      type: 'profile',
    },
    twitter: {
      card: 'summary',
      title: `@${username}'s Token Usage`,
    },
  };
}

export default function ProfilePage() {
  return <ProfilePageClient />;
}
