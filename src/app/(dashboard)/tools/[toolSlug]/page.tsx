import { ToolRunner } from '@/views/tools/tool-runner';

export default async function ToolPage({ params }: { params: Promise<{ toolSlug: string }> }) {
  const { toolSlug } = await params;
  return <ToolRunner slug={toolSlug} />;
}
