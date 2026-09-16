import { createRng, shuffle } from "./rng.js";
import type { Seat, Wish } from "./types.js";

export interface DrawSeatInput {
  /** 対象支社の座席一覧（通常席のみが抽選対象。focus/care/fixed は手動着席専用） */
  seats: Seat[];
  /** 現在の着席状況。seatId -> 着席中の personId 配列 */
  occupancy: Record<string, string[]>;
  personId: string;
  /** 話したい人リクエスト（fromId が抽選を引く本人） */
  wishes?: Wish[];
  seed?: number;
}

export interface DrawSeatResult {
  seatId: string;
  seed: number;
}

/**
 * 個人単位のオンデマンド座席抽選。
 * グループ席に空きがあればグループ席から優先して選び、その中からランダムに1つ選ぶ。
 * 「話したい人」が既に座っているグループ席に空きがあれば、それを最優先する。
 */
export function drawSeat(input: DrawSeatInput): DrawSeatResult | null {
  const seed = input.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rand = createRng(seed);

  const isOpen = (s: Seat) => {
    if (s.type !== "normal") return false; // focus/care/fixed は抽選対象外
    const occupants = input.occupancy[s.id] ?? [];
    if (occupants.includes(input.personId)) return false;
    return occupants.length < s.capacity;
  };

  const eligible = input.seats.filter(isOpen);
  if (eligible.length === 0) return null;

  const wishTargets = new Set((input.wishes ?? []).filter((w) => w.fromId === input.personId).map((w) => w.toId));
  if (wishTargets.size > 0) {
    const withWish = eligible.filter(
      (s) => s.kind === "group" && (input.occupancy[s.id] ?? []).some((pid) => wishTargets.has(pid)),
    );
    if (withWish.length > 0) return { seatId: shuffle(withWish, rand)[0].id, seed };
  }

  const groupSeats = eligible.filter((s) => s.kind === "group");
  const pool = groupSeats.length > 0 ? groupSeats : eligible;
  return { seatId: shuffle(pool, rand)[0].id, seed };
}

/**
 * 座席設定から実際の座席一覧を再生成する。
 * グループ席から若い番号を振り、その後にプライベート席を続ける。
 */
export function buildSeatsFromConfig(
  branchId: string,
  floor: string,
  config: { groups: { capacity: number; count: number }[]; privateCount: number },
): Seat[] {
  const seats: Seat[] = [];
  let number = 1;
  for (const def of config.groups) {
    for (let i = 0; i < def.count; i++) {
      seats.push({
        id: `${branchId}-${floor}-${number}`,
        branchId,
        floor,
        kind: "group",
        number,
        label: String(number),
        capacity: def.capacity,
        type: "normal",
      });
      number++;
    }
  }
  for (let i = 0; i < config.privateCount; i++) {
    seats.push({
      id: `${branchId}-${floor}-${number}`,
      branchId,
      floor,
      kind: "private",
      number,
      label: String(number),
      capacity: 1,
      type: "normal",
    });
    number++;
  }
  return seats;
}
