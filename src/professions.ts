export type GroupMode = 'classic' | 'diary';

export const professionOrder = ['女骑士', '游侠', '小女巫', '修女', '魔术师', '药剂师', '狼人', '契约师', '机械师', '调灵师', '猎魔人', '小猪妖'];
export const diaryProfessionOrder = ['女骑士', '小女巫', '游侠', '药剂师', '魔术师'];
const diaryLabels: Record<string, string> = {
  女骑士: '小骑士', 游侠: '小游侠', 小女巫: '小女巫', 药剂师: '小药剂师', 魔术师: '小魔术师',
};

export const professionChoices = (mode: GroupMode) => mode === 'diary' ? diaryProfessionOrder : professionOrder;
export const professionLabel = (value: string, mode: GroupMode) => mode === 'diary' && Object.hasOwn(diaryLabels, value) ? diaryLabels[value] : value;
export const professionText = (values: string[], mode: GroupMode) => values.map((value) => professionLabel(value, mode)).join(' / ');
