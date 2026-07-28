import { GenerateWorkspace } from '@/components/test-case/generate-workspace';

export default async function GeneratePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <GenerateWorkspace projectId={projectId} />;
}
