export type TestStep = {
  step_number: number;
  action: string;
  expected_result: string;
};

export type TestCaseFormData = {
  code: string;
  title: string;
  category: string;
  priority: string;
  preconditions: string[];
  test_data: Record<string, string>;
  steps: TestStep[];
  expected_result: string;
  status: string;
};

export interface TestCaseFormProps {
  initialData?: Partial<TestCaseFormData>;
  onSubmit: (data: TestCaseFormData) => void;
  onCancel: () => void;
  submitLabel: string;
}
