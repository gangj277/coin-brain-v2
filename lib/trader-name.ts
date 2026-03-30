const ADJECTIVES = [
  "날카로운", "침착한", "대담한", "빠른", "조용한",
  "거센", "은밀한", "냉철한", "집요한", "무심한",
  "예리한", "단단한", "끈질긴", "유연한", "고요한",
  "깊은", "민첩한", "묵직한", "차가운", "강인한",
];

const ANIMALS = [
  "매", "고래", "상어", "늑대", "독수리",
  "표범", "곰", "황소", "여우", "뱀",
  "매머드", "치타", "호랑이", "까마귀", "올빼미",
  "사자", "용", "학", "범고래", "코브라",
];

function hashAddress(address: string): number {
  const clean = address.toLowerCase().replace("0x", "");
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = ((hash << 5) - hash + clean.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function traderName(address: string): string {
  const h = hashAddress(address);
  const adj = ADJECTIVES[h % ADJECTIVES.length];
  const animal = ANIMALS[Math.floor(h / ADJECTIVES.length) % ANIMALS.length];
  const tag = address.slice(-2).toUpperCase();
  return `${adj} ${animal} #${tag}`;
}
