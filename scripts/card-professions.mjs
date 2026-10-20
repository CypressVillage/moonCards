export const professionOrder = ['女骑士', '游侠', '小女巫', '修女', '魔术师', '药剂师', '狼人', '契约师', '机械师', '调灵师', '猎魔人', '小猪妖'];
export const diaryProfessionOrder = ['女骑士', '小女巫', '游侠', '药剂师', '魔术师'];

export function sortCardProfessions(cards, mode = 'classic') {
  const order = mode === 'diary' ? diaryProfessionOrder : professionOrder;
  const rank = (name) => order.includes(name) ? order.indexOf(name) : order.length;
  return cards.map((card) => ({ ...card, classes: [...card.classes].sort((a, b) => rank(a) - rank(b)) }));
}
