export interface PropertyIconOption {
  value: string;
  label: string;
  src: string;
}

const PROPERTY_ICON_FILES = [
  'ant.svg',
  'avocado.svg',
  'baby-chick.svg',
  'bear.svg',
  'chicken.svg',
  'cow-face.svg',
  'dog-face.svg',
  'dolphin.svg',
  'duck.svg',
  'fox.svg',
  'frog.svg',
  'lion.svg',
  'melon.svg',
  'monkey-face.svg',
  'panda.svg',
  'pig-face.svg',
  'rabbit-face.svg',
  'snail.svg',
  'tropical-fish.svg',
  'unicorn.svg',
] as const;

function formatIconLabel(fileName: string) {
  return fileName
    .replace(/\.svg$/i, '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export const PROPERTY_ICON_OPTIONS: readonly PropertyIconOption[] = PROPERTY_ICON_FILES.map((fileName) => ({
  value: fileName,
  label: formatIconLabel(fileName),
  src: `/property-icon/${fileName}`,
}));

export function getPropertyIconOption(value: string): PropertyIconOption | null {
  const normalized = value.trim();
  if (!normalized) return null;
  return PROPERTY_ICON_OPTIONS.find((option) => option.value === normalized) ?? null;
}
