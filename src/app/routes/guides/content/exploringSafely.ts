import { ent, guide, p, slots, t, tips, wiki, type Guide } from '../guideModel'

/**
 * Guide 2 — exploring safely. Facts cite: Guide:Getting_started (torches/glowsticks),
 * Lesser_Healing_Potion + Mushroom + Potion_Sickness, Magic_Mirror / Ice_Mirror / Recall_Potion,
 * Bed, Fall_damage, Lava + Obsidian_Skin_Potion, Gold_Chest (accessory loot), Grappling_Hook,
 * Life_Crystal, Death + Piggy_Bank, Layers and the three utility-potion articles. Accessory effects
 * and drop sources are the dataset's.
 */
export const exploringSafely: Guide = {
  slug: 'exploring-safely',
  title: 'Exploring safely',
  topic: 'Exploring',
  stages: ['early-prehm'],
  summary: 'Light, healing, a quick way home, and the accessories that help in caves and on long drops.',
  intro: [
    t`Much of what makes you stronger is underground: ore, chests and ${wiki('Life_Crystal', 'Life Crystals', 29)}. Going down also means darkness, long drops and, deeper still, lava. A little preparation before each trip goes a long way.`,
  ],
  sections: [
    {
      id: 'light',
      title: 'Light your way',
      blocks: [
        p(
          t`Carry ${wiki('Torch', 'Torches', 8)} and place them as you go. The ${wiki('Guide:Getting_started', 'getting-started guide')} recommends Torches and ${wiki('Glowstick', 'Glowsticks', 282)} so you don’t walk into an enemy you didn’t see — and a trail of torches marks the way back.`,
        ),
        p(t`The ${ent('i:88', 'Mining Helmet')} provides light while you wear it, which keeps your hands free for tools and weapons.`),
      ],
    },
    {
      id: 'healing',
      title: 'Bring healing',
      blocks: [
        p(
          t`${wiki('Lesser_Healing_Potion', 'Lesser Healing Potions', 28)} are brewed from a ${wiki('Mushroom', 'Mushroom', 5)}, ${ent('i:23', 'Gel')} and ${wiki('Bottle', 'Bottles', 31)} at a placed Bottle, and the Merchant sells them too. Mushrooms grow on grass on the surface, and you can eat one in a pinch.`,
        ),
        p(
          t`Using any healing item gives you ${wiki('Potion_Sickness', 'Potion Sickness')}, which blocks further healing items for a while. Drink before your health is critically low, not after.`,
        ),
        slots(
          'Healing',
          wiki('Lesser_Healing_Potion', 'Lesser Healing Potion', 28),
          wiki('Mushroom', 'Mushroom', 5),
          ent('i:23', 'Gel'),
          wiki('Bottle', 'Bottle', 31),
        ),
      ],
    },
    {
      id: 'way-home',
      title: 'Know your way home',
      blocks: [
        p(
          t`A ${wiki('Magic_Mirror', 'Magic Mirror', 50)} teleports you to your spawn point. It turns up in chests in the Underground and Cavern layers, and the ${wiki('Ice_Mirror', 'Ice Mirror', 3199)} from the ice biome works the same way. A ${wiki('Recall_Potion', 'Recall Potion', 2350)} also sends you home, one use per potion.`,
        ),
        p(
          t`Your spawn point is where you first appeared until you set a new one: activate a ${wiki('Bed', 'Bed', 224)} placed in a valid room. Respawning next to your base saves a long walk after a bad fall.`,
        ),
        slots(
          'Ways home',
          wiki('Magic_Mirror', 'Magic Mirror', 50),
          wiki('Ice_Mirror', 'Ice Mirror', 3199),
          wiki('Recall_Potion', 'Recall Potion', 2350),
          wiki('Bed', 'Bed', 224),
        ),
      ],
    },
    {
      id: 'falls-lava',
      title: 'Falls and lava',
      blocks: [
        p(
          t`Long drops hurt: past a set height, ${wiki('Fall_damage', 'fall damage')} grows with every extra tile you fall. The ${ent('i:158', 'Lucky Horseshoe')} negates it, and so does landing in water. ${wiki('Rope', 'Rope', 965)} lets you climb down a deep shaft instead of jumping.`,
        ),
        p(
          t`${wiki('Lava', 'Lava')} sits deep in the Cavern layer and throughout the Underworld. Touching it deals heavy damage and sets you ${ent('buff:on-fire', 'On Fire!')}. An ${wiki('Obsidian_Skin_Potion', 'Obsidian Skin Potion', 288)} makes you immune to lava for several minutes.`,
        ),
      ],
    },
    {
      id: 'movement',
      title: 'Movement accessories',
      blocks: [
        p(
          t`${wiki('Gold_Chest', 'Gold Chests')} in the Underground and Cavern layers can hold accessories such as ${ent('i:54', 'Hermes Boots')} (run super fast), the ${ent('i:53', 'Cloud in a Bottle')} (double jump) and ${ent('i:975', 'Shoe Spikes')} (slide down walls). Each one makes caves quicker to cross and easier to escape.`,
        ),
        p(
          t`A ${wiki('Grappling_Hook', 'Grappling Hook', 84)} fires a chain that pulls you to blocks and platforms. Craft it from a Hook and Chains at an anvil, or buy one from the Goblin Tinkerer.`,
        ),
        slots(
          'Getting around',
          ent('i:54', 'Hermes Boots'),
          ent('i:53', 'Cloud in a Bottle'),
          ent('i:975', 'Shoe Spikes'),
          ent('i:953', 'Climbing Claws'),
          ent('i:158', 'Lucky Horseshoe'),
          wiki('Grappling_Hook', 'Grappling Hook', 84),
        ),
      ],
    },
    {
      id: 'life',
      title: 'Grow your health',
      blocks: [
        p(
          t`Each ${wiki('Life_Crystal', 'Life Crystal', 29)} permanently raises your maximum life by 20, for up to 15 crystals. They sit in the Underground layer and below; break them with a pickaxe and use them straight away.`,
        ),
      ],
    },
    {
      id: 'dying',
      title: 'If things go wrong',
      blocks: [
        p(
          t`A Classic character who dies drops some or all of the coins they carry, depending on the world’s difficulty, keeps their items, and respawns at their spawn point. Mediumcore and Hardcore characters lose more — the ${wiki('Death', 'Death')} article has the details.`,
        ),
        p(
          t`Coins and items in a ${wiki('Piggy_Bank', 'Piggy Bank', 87)} are never dropped on death. The ${wiki('Merchant', 'Merchant')} sells one.`,
        ),
        tips(
          t`Before a long trip, bank your coins, top up your torches and potions, and check that your spawn point is at home.`,
          t`Ready for a fight instead of a dig? ${guide('first-boss-prep', 'Preparing for your first boss')} covers the next step.`,
        ),
      ],
    },
  ],
  checklist: [
    { id: 'torches', text: 'Carry a full stack of Torches before going underground' },
    { id: 'healing', text: 'Craft or buy a few Lesser Healing Potions' },
    { id: 'piggy-bank', text: 'Store spare coins in a Piggy Bank' },
    { id: 'bed', text: 'Set your spawn point with a Bed in your base' },
    { id: 'way-home', text: 'Find a Magic Mirror or Ice Mirror, or carry Recall Potions' },
    { id: 'life-crystals', text: 'Use every Life Crystal you find' },
    { id: 'movement', text: 'Equip a movement accessory' },
    { id: 'hook', text: 'Craft or buy a Grappling Hook' },
  ],
  advanced: {
    title: 'Reading depth, and potions for the dark',
    blocks: [
      p(
        t`The world is split into ${wiki('Layers', 'layers')}: Space, the Surface, the Underground, the Cavern and the Underworld at the bottom.`,
      ),
      p(
        t`A ${ent('i:18', 'Depth Meter')} displays your depth and a ${ent('i:393', 'Compass')} your horizontal position — handy for noting where a chest or ore vein was.`,
      ),
      p(
        t`Three potions change how a cave feels: the ${wiki('Spelunker_Potion', 'Spelunker Potion', 296)} highlights nearby ores, chests and Life Crystals; the ${wiki('Shine_Potion', 'Shine Potion', 298)} makes you emit bright light; and the ${wiki('Night_Owl_Potion', 'Night Owl Potion', 299)} improves night vision.`,
      ),
    ],
  },
}
