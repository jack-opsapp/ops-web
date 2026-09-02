import { SocialCommandDeck } from "./_components/social-command-deck";

export const dynamic = "force-dynamic";

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<{ post?: string }>;
}) {
  const { post } = await searchParams;
  return <SocialCommandDeck initialPostId={post} />;
}
