export type EmojiCategory = {
  label: string;
  emojis: string[];
};

// A compact unicode emoji set (no dependency). Add more any time.
export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    label: 'Smileys',
    emojis: [
      '😀','😃','😄','😁','😆','😅','😂','🤣','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤗','🤭','🤫','🤔','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','🥱','😴','😌','😛','😜','😝',
    ],
  },
  {
    label: 'Gestures',
    emojis: ['👍','👎','👏','🙌','🫶','🤝','✌️','🤞','🤟','👌','👀','💪','🫡','🙏','🖐️','👋'],
  },
  {
    label: 'Hearts',
    emojis: ['❤️','🧡','💛','💚','💙','💜','🤎','🖤','🤍','💖','💘','💝','💞','💕','💓','💗'],
  },
  {
    label: 'Objects',
    emojis: ['🎉','🎊','✨','🔥','💯','📌','📣','🔗','🧠','💡','🛠️','📎','🗂️','📝','📷','🎁','☕'],
  },
  {
    label: 'Nature',
    emojis: ['🌞','🌝','🌧️','🌈','🌊','🍃','🌸','🌼','🌻','🌙','⭐','⚡','❄️'],
  },
];

export const ALL_EMOJIS: string[] = Array.from(
  new Set(EMOJI_CATEGORIES.flatMap((c) => c.emojis)),
);
