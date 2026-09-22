/**
 * Unit tests cho services/documents/figma-client.ts — flattenFigmaAtoms.
 *
 * Loi duoc chan: MAX_ATOMS = 300 (hang so cung) + duyet dung THU TU man hinh
 * -> man hinh xuat hien SAU trong file khong bao gio tro thanh atom. Ban sua
 * doi sang lay mau RAI DEU tren tung man hinh sau khi da duyet HET cay.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { flattenFigmaAtoms } from '@/services/documents/figma-client';

type Node = {
  id: string;
  name: string;
  type: string;
  characters?: string;
  children?: Node[];
};

/** Tạo 1 "màn hình" (FRAME) chứa N text layer. */
function screen(name: string, textCount: number): Node {
  return {
    id: name,
    name,
    type: 'FRAME',
    children: Array.from({ length: textCount }, (_, i) => ({
      id: `${name}-text-${i}`,
      name: `text-${i}`,
      type: 'TEXT',
      characters: `Nội dung ${name} #${i}`,
    })),
  };
}

function documentWithScreens(screens: Node[]): Node {
  return {
    id: 'root',
    name: 'root',
    type: 'DOCUMENT',
    children: [{ id: 'page-1', name: 'Page 1', type: 'CANVAS', children: screens }],
  };
}

describe('flattenFigmaAtoms', () => {
  afterEach(() => {
    delete process.env.AI_FIGMA_MAX_ATOMS;
  });

  it('không cắt khi tổng số atom trong giới hạn', () => {
    const root = documentWithScreens([screen('Login', 5), screen('Dashboard', 5)]);
    const result = flattenFigmaAtoms(root, { maxAtoms: 50 });

    expect(result.truncated).toBe(false);
    expect(result.atoms).toHaveLength(10);
    expect(result.atoms_before_cap).toBe(10);
  });

  it('màn hình cuối vẫn có mặt trong kết quả khi vượt giới hạn (không bị xoá sổ)', () => {
    // Trước đây: duyệt tuần tự theo thứ tự màn hình + cắt cứng ở MAX_ATOMS khiến
    // "LastScreen" (xuất hiện sau cùng) không bao giờ được duyệt tới.
    const root = documentWithScreens([
      screen('FirstScreen', 80),
      screen('MiddleScreen', 80),
      screen('LastScreen', 80),
    ]);

    const result = flattenFigmaAtoms(root, { maxAtoms: 60 });

    expect(result.truncated).toBe(true);
    expect(result.atoms_before_cap).toBe(240);
    expect(result.atoms.length).toBeLessThanOrEqual(60);

    const screensRepresented = new Set(result.atoms.map((a) => a.screen_or_section));
    expect(screensRepresented.has('FirstScreen')).toBe(true);
    expect(screensRepresented.has('MiddleScreen')).toBe(true);
    expect(screensRepresented.has('LastScreen')).toBe(true); // <- điểm mấu chốt
  });

  it('phân bổ mẫu tỉ lệ thuận với kích thước từng màn hình', () => {
    const root = documentWithScreens([screen('Big', 90), screen('Small', 10)]);
    const result = flattenFigmaAtoms(root, { maxAtoms: 50 });

    const bigCount = result.atoms.filter((a) => a.screen_or_section === 'Big').length;
    const smallCount = result.atoms.filter((a) => a.screen_or_section === 'Small').length;

    expect(bigCount).toBeGreaterThan(smallCount);
    expect(smallCount).toBeGreaterThan(0); // màn hình nhỏ vẫn được đại diện, không về 0
  });

  it('đọc giới hạn từ AI_FIGMA_MAX_ATOMS khi không truyền option', () => {
    process.env.AI_FIGMA_MAX_ATOMS = '20';
    const root = documentWithScreens([screen('Only', 50)]);
    const result = flattenFigmaAtoms(root);
    expect(result.atoms.length).toBeLessThanOrEqual(20);
    expect(result.truncated).toBe(true);
  });

  it('atom_id duy nhất kể cả khi 2 layer trùng tên trên cùng màn hình', () => {
    const root = documentWithScreens([
      {
        ...screen('Login', 0),
        children: [
          { id: 'a', name: 'Label', type: 'TEXT', characters: 'Email' },
          { id: 'b', name: 'Label', type: 'TEXT', characters: 'Password' },
        ],
      },
    ]);
    const result = flattenFigmaAtoms(root, { maxAtoms: 100 });
    const ids = result.atoms.map((a) => a.atom_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('component tương tác (INSTANCE) cũng được atomize, không chỉ TEXT', () => {
    const root = documentWithScreens([
      { ...screen('Login', 0), children: [{ id: 'btn', name: 'Submit Button', type: 'INSTANCE' }] },
    ]);
    const result = flattenFigmaAtoms(root, { maxAtoms: 100 });
    expect(result.atoms).toHaveLength(1);
    expect(result.atoms[0].label).toBe('Submit Button');
  });
});
