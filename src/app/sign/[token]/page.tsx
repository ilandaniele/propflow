import SignPageClient from './SignPageClient';

interface Props {
  params: Promise<{ token: string }>;
}

export default async function SignPage({ params }: Props) {
  const { token } = await params;
  return <SignPageClient token={token} />;
}
