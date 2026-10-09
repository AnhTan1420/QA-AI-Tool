/**
 * A CLEAN, realistic login suite used as the baseline for the seeded-defect harness
 * (src/__tests__/services/seeded-defect-harness.test.ts). "Clean" is a testable claim:
 * `seeded-fixture-baseline` asserts the deterministic layer finds NOTHING in it, so every
 * finding after a mutation is attributable to the injected defect.
 */
import type { GeneratedTestCase } from '@/models/validators/test-case';
import type { ParsedDocument } from '@/models/validators/document';
import type { L0Context } from '@/services/ai/review-pipeline';

export const SEEDED_REQUIREMENT =
  "Hệ thống phải cho phép người dùng đăng nhập bằng email và mật khẩu hợp lệ. Email bắt buộc, đúng định dạng email, tối đa 100 ký tự. Mật khẩu bắt buộc, từ 8 đến 20 ký tự. Sai mật khẩu 5 lần liên tục thì khóa tài khoản 15 phút. Chỉ tài khoản có trạng thái active mới được đăng nhập. Khi đăng nhập sai hiển thị thông báo 'Email hoặc mật khẩu không đúng'.";

export const SEEDED_DOCUMENT: ParsedDocument = {
  id: 'doc-login',
  source_type: 'document',
  title: 'Đặc tả đăng nhập',
  summary: 'Đăng nhập bằng email và mật khẩu, khóa tài khoản sau 5 lần sai.',
  atoms: [
    { atom_id: 'A_RULE_LOGIN', atom_type: 'rule', label: 'Đăng nhập hợp lệ', detail: 'Người dùng đăng nhập bằng email và mật khẩu hợp lệ thì vào trang dashboard' },
    { atom_id: 'A_RULE_LOCK', atom_type: 'rule', label: 'Khóa tài khoản', detail: 'Sai mật khẩu 5 lần liên tục thì khóa tài khoản 15 phút' },
    { atom_id: 'A_RULE_ACTIVE', atom_type: 'rule', label: 'Chỉ tài khoản active', detail: 'Chỉ tài khoản có trạng thái active mới được đăng nhập' },
    { atom_id: 'A_FIELD_PWD', atom_type: 'field', label: 'Mật khẩu', detail: 'Bắt buộc, độ dài từ 8 đến 20 ký tự' },
    { atom_id: 'A_FIELD_EMAIL', atom_type: 'field', label: 'Email', detail: 'Bắt buộc, đúng định dạng email, tối đa 100 ký tự' },
    { atom_id: 'A_MSG_ERR', atom_type: 'screen_element', label: 'Email hoặc mật khẩu không đúng', detail: 'Thông báo lỗi hiển thị khi đăng nhập sai' },
    { atom_id: 'A_UI_NAME', atom_type: 'screen_element', label: 'Tên người dùng', detail: 'Hiển thị tên người dùng ở góc phải trang Dashboard' },
  ],
};

type StepPair = [action: string, expected: string];

function mk(
  code: string,
  title: string,
  category: GeneratedTestCase['category'],
  priority: GeneratedTestCase['priority'],
  ids: string[],
  data: Record<string, string>,
  steps: StepPair[],
  final: string,
  preconditions: string[] = ["Tài khoản tồn tại với trạng thái 'active'", 'Trình duyệt mới, chưa có session'],
): GeneratedTestCase {
  return {
    code,
    title,
    category,
    priority,
    preconditions,
    test_data: data,
    steps: steps.map(([action, expected_result], i) => ({ step_number: i + 1, action, expected_result })),
    final_expected_result: final,
    source_requirement_ids: ids,
  };
}

const OPEN: StepPair = ["Mở trang 'Đăng nhập'", "Form hiển thị field 'Email' và field 'Mật khẩu'"];
const typeEmail = (v: string, expected = "Field 'Email' không hiển thị lỗi"): StepPair => [`Nhập '${v}' vào field 'Email'`, expected];
const typePwd = (v: string, expected = 'Mật khẩu được che bằng dấu chấm'): StepPair => [`Nhập '${v}' vào field 'Mật khẩu'`, expected];
const submit = (expected: string): StepPair => ["Bấm nút 'Đăng nhập'", expected];

const EMAIL_A = 'nguyen.van.a@company.com';
const PWD_OK = 'Str0ng!Pass#1';
const PWD_BAD = 'Wr0ng!Pass#9';
const LONG_EMAIL = `${'a'.repeat(88)}@company.com`;

export function buildCleanSuite(): GeneratedTestCase[] {
  return [
    mk('TC_LOGIN_001', 'Đăng nhập với email và mật khẩu hợp lệ vào trang dashboard', 'positive', 'Critical', ['A_RULE_LOGIN', 'A_UI_NAME'],
      { email: EMAIL_A, password: PWD_OK },
      [OPEN, typeEmail(EMAIL_A), typePwd(PWD_OK), submit("Hệ thống trả về HTTP 200 và chuyển sang '/dashboard'"), ["Quan sát góc phải trang 'Dashboard'", "Hiển thị 'Tên người dùng' là 'Nguyễn Văn A'"]],
      "Người dùng ở trang '/dashboard', session token được tạo và 1 dòng audit log LOGIN_SUCCESS được ghi"),
    mk('TC_LOGIN_002', 'Đăng nhập với email viết hoa thường lẫn lộn vẫn được chấp nhận', 'positive', 'Major', ['A_FIELD_EMAIL'],
      { email: 'Nguyen.Van.A@Company.COM', password: PWD_OK },
      [OPEN, typeEmail('Nguyen.Van.A@Company.COM'), typePwd(PWD_OK), submit("Hệ thống trả về HTTP 200 và chuyển sang '/dashboard'"), ["Quan sát thanh địa chỉ trình duyệt", "URL kết thúc bằng '/dashboard'"]],
      "Người dùng ở trang '/dashboard' với session token mới"),
    mk('TC_LOGIN_003', 'Hiển thị đúng tên người dùng ở góc phải sau khi đăng nhập', 'positive', 'Normal', ['A_UI_NAME'],
      { email: 'tran.thi.b@company.com', password: 'An0ther!Pass#2' },
      [OPEN, typeEmail('tran.thi.b@company.com'), typePwd('An0ther!Pass#2'), submit("Hệ thống chuyển sang '/dashboard' với HTTP 200"), ["Quan sát góc phải trang 'Dashboard'", "Hiển thị 'Tên người dùng' là 'Trần Thị B'"]],
      "Góc phải trang '/dashboard' hiển thị 'Tên người dùng' là 'Trần Thị B'"),
    mk('TC_LOGIN_004', 'Đăng nhập lại bình thường sau khi đã đăng xuất khỏi hệ thống', 'positive', 'Major', ['A_RULE_LOGIN'],
      { email: 'le.van.c@company.com', password: 'Secur3!Word#3' },
      [OPEN, typeEmail('le.van.c@company.com'), typePwd('Secur3!Word#3'), submit("Hệ thống chuyển sang '/dashboard' với HTTP 200"), ["Bấm nút 'Đăng xuất' rồi đăng nhập lại cùng tài khoản", "Hệ thống chuyển sang '/dashboard' với session token mới khác token cũ"]],
      "Người dùng ở trang '/dashboard', token cũ bị vô hiệu và token mới còn hiệu lực"),

    mk('TC_LOGIN_005', 'Sai mật khẩu hiển thị thông báo lỗi chung và không đăng nhập', 'negative', 'Critical', ['A_RULE_LOGIN', 'A_MSG_ERR'],
      { email: EMAIL_A, password: PWD_BAD },
      [OPEN, typeEmail(EMAIL_A), typePwd(PWD_BAD), submit("Hệ thống trả về HTTP 401 và ở lại trang 'Đăng nhập'"), ["Quan sát vùng thông báo dưới form", "Hiển thị 'Email hoặc mật khẩu không đúng'"]],
      "Người dùng ở lại trang 'Đăng nhập', không có session token, bộ đếm sai mật khẩu tăng 1"),
    mk('TC_LOGIN_006', 'Sai mật khẩu lần thứ 5 liên tục thì khóa tài khoản 15 phút', 'negative', 'Critical', ['A_RULE_LOCK'],
      { email: EMAIL_A, password: PWD_BAD },
      [OPEN, typeEmail(EMAIL_A), typePwd(PWD_BAD), submit('Lần 1 bị từ chối, bộ đếm sai bằng 1'), ["Lặp lại bước bấm nút 'Đăng nhập' với cùng mật khẩu sai 4 lần nữa", 'Đến lần thứ 5 hệ thống khóa tài khoản trong 15 phút'], ["Nhập mật khẩu đúng rồi bấm nút 'Đăng nhập' trong thời gian khóa", 'Đăng nhập vẫn bị từ chối vì tài khoản đang bị khóa']],
      'Tài khoản bị khóa 15 phút, 1 dòng audit log ACCOUNT_LOCKED được ghi và không có session token'),
    mk('TC_LOGIN_007', 'Email chưa đăng ký trong hệ thống bị từ chối đăng nhập', 'negative', 'Major', ['A_RULE_LOGIN'],
      { email: 'khong.ton.tai@company.com', password: PWD_OK },
      [OPEN, typeEmail('khong.ton.tai@company.com'), typePwd(PWD_OK), submit("Hệ thống trả về HTTP 401 và ở lại trang 'Đăng nhập'"), ["Quan sát vùng thông báo dưới form", "Hiển thị 'Email hoặc mật khẩu không đúng'"]],
      "Không có session token và thông báo không tiết lộ email có tồn tại hay không"),
    mk('TC_LOGIN_008', 'Tài khoản có trạng thái inactive không được phép đăng nhập', 'negative', 'Major', ['A_RULE_ACTIVE'],
      { email: 'inactive.user@company.com', password: PWD_OK },
      [OPEN, typeEmail('inactive.user@company.com'), typePwd(PWD_OK), submit("Hệ thống trả về HTTP 403 và ở lại trang 'Đăng nhập'"), ["Quan sát trạng thái tài khoản trong trang quản trị", "Trạng thái vẫn là 'inactive', không có session token"]],
      "Tài khoản inactive không đăng nhập được và không có session token nào được tạo",
      ["Tài khoản tồn tại với trạng thái 'inactive'", 'Trình duyệt mới, chưa có session']),
    mk('TC_LOGIN_009', 'Để trống cả email và mật khẩu thì không gửi yêu cầu đăng nhập', 'negative', 'Major', ['A_FIELD_EMAIL', 'A_FIELD_PWD'],
      {},
      [OPEN, ["Để trống field 'Email' và field 'Mật khẩu'", 'Hai field vẫn rỗng'], submit("Hiển thị lỗi bắt buộc nhập dưới field 'Email' và field 'Mật khẩu'"), ['Quan sát tab Network của trình duyệt', 'Không có request đăng nhập nào được gửi đi'], ["Quan sát trang hiện tại", "Người dùng vẫn ở trang 'Đăng nhập'"]],
      "Không có request nào được gửi và không có session token được tạo"),

    mk('TC_LOGIN_010', 'Mật khẩu dài đúng 8 ký tự là giá trị biên dưới hợp lệ', 'boundary', 'Major', ['A_FIELD_PWD'],
      { email: EMAIL_A, password: 'Ab1!cdef' },
      [OPEN, typeEmail(EMAIL_A), typePwd('Ab1!cdef'), submit("Hệ thống chuyển sang '/dashboard' với HTTP 200"), ['Quan sát độ dài mật khẩu đã nhập', 'Mật khẩu có đúng 8 ký tự']],
      "Người dùng ở trang '/dashboard' với session token được tạo"),
    mk('TC_LOGIN_011', 'Mật khẩu dài đúng 20 ký tự là giá trị biên trên hợp lệ', 'boundary', 'Major', ['A_FIELD_PWD'],
      { email: EMAIL_A, password: 'Ab1!cdefghijklmnopqr' },
      [OPEN, typeEmail(EMAIL_A), typePwd('Ab1!cdefghijklmnopqr'), submit("Hệ thống chuyển sang '/dashboard' với HTTP 200"), ['Quan sát độ dài mật khẩu đã nhập', 'Mật khẩu có đúng 20 ký tự']],
      "Người dùng ở trang '/dashboard' với session token được tạo"),
    mk('TC_LOGIN_012', 'Mật khẩu dài 21 ký tự vượt biên trên bị từ chối', 'boundary', 'Major', ['A_FIELD_PWD'],
      { email: EMAIL_A, password: 'Ab1!cdefghijklmnopqrs' },
      [OPEN, typeEmail(EMAIL_A), typePwd('Ab1!cdefghijklmnopqrs'), submit("Hiển thị lỗi độ dài dưới field 'Mật khẩu' và không gửi yêu cầu"), ['Quan sát độ dài mật khẩu đã nhập', 'Mật khẩu có 21 ký tự, vượt giới hạn 20']],
      "Người dùng ở lại trang 'Đăng nhập' và không có session token"),
    mk('TC_LOGIN_013', 'Email dài đúng 100 ký tự là giá trị biên trên hợp lệ', 'boundary', 'Major', ['A_FIELD_EMAIL'],
      { email: LONG_EMAIL, password: PWD_OK },
      [OPEN, typeEmail(LONG_EMAIL), typePwd(PWD_OK), submit("Hệ thống chuyển sang '/dashboard' với HTTP 200"), ['Quan sát độ dài email đã nhập', 'Email có đúng 100 ký tự']],
      "Người dùng ở trang '/dashboard' với session token được tạo"),
  ];
}

export const SEEDED_CTX: L0Context = {
  requirement_description: SEEDED_REQUIREMENT,
  documents: [SEEDED_DOCUMENT],
  language: 'Tiếng Việt',
  detail_level: 'standard',
  required_categories: ['positive', 'negative', 'boundary'],
  per_category_min: 4,
};
