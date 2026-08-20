export type TestCase = {
  id: string;
  code: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  automation_status?: 'not_generated' | 'generated' | 'passed' | 'failed';
};
