/**
 * Unit tests cho capElementMapEvenly (services/automation/browser-runner.ts).
 *
 * Loi duoc chan: `[...element_map, ...snapshot].slice(0, MAX)` giu N phan tu
 * DAU TIEN. Mot khi element_map da day, moi snapshot moi bi vut bo HOAN TOAN vi
 * mang noi vao luon dai hon MAX va slice(0, MAX) luon tra ve dung N phan tu cu
 * — nghia la MOI trang/buoc sau thoi diem cham tran mat grounding vinh vien.
 */
import { describe, it, expect } from 'vitest';
import { capElementMapEvenly } from '@/services/automation/browser-runner';
import type { ElementMap, InspectedElement } from '@/models/validators/playwright';

function el(pageLabel: string, i: number): InspectedElement {
  return {
    role: 'button',
    accessible_name: `${pageLabel} button ${i}`,
    tag: 'button',
    selector: `[data-testid="${pageLabel}-${i}"]`,
    selector_strategy: 'test_id',
    is_visible: true,
    page_url: `https://app.example.com/${pageLabel}`,
    page_label: pageLabel,
  };
}

function pageOf(count: number, label: string): ElementMap {
  return Array.from({ length: count }, (_, i) => el(label, i));
}

describe('capElementMapEvenly', () => {
  it('không đổi gì khi đã trong giới hạn', () => {
    const map = [...pageOf(5, 'A'), ...pageOf(5, 'B')];
    const result = capElementMapEvenly(map, 20);
    expect(result.map).toHaveLength(10);
    expect(result.dropped).toBe(0);
  });

  it('BUG CŨ: slice(0, N) làm trang thứ 2 biến mất hoàn toàn một khi đã đầy — hàm mới không được lặp lại lỗi này', () => {
    // Mô phỏng chính xác luồng cũ: map đã đầy 400 (page A), rồi 1 snapshot mới
    // (page B) được nối vào. slice(0, 400) sẽ giữ nguyên A và xoá sạch B.
    const full = pageOf(400, 'A');
    const newSnapshot = pageOf(50, 'B');

    const result = capElementMapEvenly([...full, ...newSnapshot], 400);

    // Hành vi ĐÚNG: B phải có mặt, kể cả khi phải hy sinh bớt phần tử của A.
    const pagesRepresented = new Set(result.map.map((e) => e.page_label));
    expect(pagesRepresented.has('B')).toBe(true);
    expect(result.map.filter((e) => e.page_label === 'B').length).toBeGreaterThan(0);
  });

  it('phân bổ theo tỉ lệ kích thước của từng trang', () => {
    const map = [...pageOf(90, 'Big'), ...pageOf(10, 'Small')];
    const result = capElementMapEvenly(map, 50);

    const big = result.map.filter((e) => e.page_label === 'Big').length;
    const small = result.map.filter((e) => e.page_label === 'Small').length;

    expect(big).toBeGreaterThan(small);
    expect(small).toBeGreaterThan(0); // trang nhỏ vẫn được đại diện
  });

  it('3 trang trở lên: KHÔNG trang nào bị loại hoàn toàn', () => {
    const map = [...pageOf(200, 'P1'), ...pageOf(200, 'P2'), ...pageOf(200, 'P3')];
    const result = capElementMapEvenly(map, 150);

    for (const label of ['P1', 'P2', 'P3']) {
      expect(result.map.some((e) => e.page_label === label)).toBe(true);
    }
  });

  it('không vượt quá maxTotal', () => {
    const map = [...pageOf(100, 'A'), ...pageOf(100, 'B'), ...pageOf(100, 'C')];
    const result = capElementMapEvenly(map, 77);
    expect(result.map.length).toBeLessThanOrEqual(77);
  });

  it('dùng page_url khi thiếu page_label', () => {
    const withUrlOnly: ElementMap = Array.from({ length: 60 }, (_, i) => ({
      role: 'link',
      accessible_name: `link ${i}`,
      tag: 'a',
      selector: `#l${i}`,
      selector_strategy: 'css',
      is_visible: true,
      page_url: 'https://app.example.com/page-a',
    }));
    const result = capElementMapEvenly(withUrlOnly, 30);
    expect(result.map.length).toBeLessThanOrEqual(30);
    expect(result.map.length).toBeGreaterThan(0);
  });

  it('phần tử không có page_url/page_label vẫn được nhóm và giữ lại (nhóm "(unlabeled)")', () => {
    const noLabel: ElementMap = Array.from({ length: 10 }, (_, i) => ({
      role: 'button',
      accessible_name: `x${i}`,
      tag: 'button',
      selector: `#x${i}`,
      selector_strategy: 'css',
      is_visible: true,
    }));
    const result = capElementMapEvenly(noLabel, 5);
    expect(result.map.length).toBeGreaterThan(0);
  });
});
