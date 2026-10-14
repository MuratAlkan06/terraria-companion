import { ent, guide, p, slots, t, tips, wiki, type Guide } from '../guideModel'

/**
 * Guide 1 — a new world's first day. Facts cite: Guide:Getting_started (starting items, ~200 wood,
 * torches), Guide (NPC crafting help), House + NPCs (housing rules, housing query), Night (night
 * enemies), Ores + Copper_Ore (ore pairs, where Copper is). Recipes are the dataset's.
 */
export const newWorld: Guide = {
  slug: 'new-world',
  title: 'Your first day in a new world',
  topic: 'New world',
  stages: ['early-prehm'],
  summary: 'Wood, a work bench, a safe room before dark, and the first upgrades worth chasing.',
  intro: [
    t`A new Classic character starts with a ${ent('i:3507', 'Copper Shortsword')}, a ${wiki('Copper_Pickaxe', 'Copper Pickaxe', 3509)} and a ${wiki('Copper_Axe', 'Copper Axe', 3506)}, standing next to a friendly NPC called the ${wiki('Guide', 'Guide')}. The wiki’s ${wiki('Guide:Getting_started', 'getting-started guide')} covers the basics in depth; this page is the short version.`,
    t`Daytime on the surface is fairly calm. At ${wiki('Night', 'night')}, ${ent('enemy:zombie', 'Zombie', 'Zombies')} and ${ent('enemy:demon-eye', 'Demon Eye', 'Demon Eyes')} come out, so use the daylight to gather wood, build a shelter and light it.`,
  ],
  sections: [
    {
      id: 'wood',
      title: 'Gather wood first',
      blocks: [
        p(
          t`Swing the ${wiki('Copper_Axe', 'Copper Axe', 3506)} at trees to collect ${wiki('Wood', 'Wood', 9)}. Almost everything you make on day one starts with it: your first crafting station, furniture, a backup weapon, even a set of ${ent('set:wood-armor', 'Wood armor')}. The getting-started guide suggests collecting about 200 pieces before you start building.`,
        ),
        slots(
          'Made from wood',
          wiki('Work_Bench', 'Work Bench', 36),
          ent('i:24', 'Wooden Sword'),
          ent('i:39', 'Wooden Bow'),
          ent('set:wood-armor', 'Wood armor'),
        ),
      ],
    },
    {
      id: 'work-bench',
      title: 'Craft a Work Bench, then the basics',
      blocks: [
        p(
          t`Open your inventory and craft a ${wiki('Work_Bench', 'Work Bench', 36)} from Wood — it needs no station of its own. With the Work Bench placed nearby you can craft a ${wiki('Wooden_Door', 'Wooden Door', 25)}, a ${wiki('Wooden_Chair', 'Wooden Chair', 34)}, a ${wiki('Wooden_Table', 'Wooden Table', 32)}, the ${ent('i:24', 'Wooden Sword')} and the ${ent('i:39', 'Wooden Bow')}.`,
        ),
        p(
          t`${ent('i:23', 'Gel')} drops from slimes such as the ${ent('enemy:green-slime', 'Green Slime')}. Gel plus Wood makes ${wiki('Torch', 'Torches', 8)}, crafted by hand — no station needed.`,
        ),
        slots(
          'Day-one crafting',
          ent('i:23', 'Gel'),
          wiki('Torch', 'Torch', 8),
          wiki('Wooden_Door', 'Wooden Door', 25),
          wiki('Wooden_Chair', 'Wooden Chair', 34),
          wiki('Wooden_Table', 'Wooden Table', 32),
        ),
        tips(
          t`The ${wiki('Guide', 'Guide')} can tell you what an item is used for: talk to him and show him the item to see what it crafts into.`,
          t`Build near the spot where you first appeared — the getting-started guide suggests starting your base there.`,
        ),
      ],
    },
    {
      id: 'house',
      title: 'Build a house before dark',
      blocks: [
        p(
          t`A small, closed room keeps you out of the open at night and gives the Guide somewhere to live. For a room to count as a ${wiki('House', 'house')}, it needs a frame of blocks, background walls, a door, a light source, a table and a chair — a Work Bench counts as the table.`,
        ),
        p(
          t`Other ${wiki('NPCs', 'town NPCs')} move in once their own conditions are met and an empty valid house is waiting, so it pays to add rooms over time. The housing menu’s housing query tells you whether a room counts.`,
        ),
        tips(
          t`Check each new room with the housing query before you furnish the next one.`,
          t`A ${wiki('Torch', 'Torch', 8)} on the wall is the simplest light source for a room.`,
        ),
      ],
    },
    {
      id: 'first-upgrades',
      title: 'Your first upgrades',
      blocks: [
        p(
          t`${wiki('Copper_Ore', 'Copper Ore')} — or Tin, which replaces it in some worlds — is usually the first ore you find, in the Underground layer just below the surface and occasionally on it. A world generally has only one ore from each pair (Copper or Tin, Iron or Lead, and so on; see ${wiki('Ores', 'Ores')}).`,
        ),
        p(
          t`Smelt ore into bars at a ${wiki('Furnace', 'Furnace', 33)}, which you build at the Work Bench from stone, wood and torches. Then make an ${wiki('Iron_Anvil', 'Iron Anvil', 35)} or ${wiki('Lead_Anvil', 'Lead Anvil', 716)}: most metal tools, weapons and armor are crafted there. ${guide('better-equipment', 'Better equipment')} walks through the whole ore ladder.`,
        ),
        slots(
          'Your first metal',
          wiki('Furnace', 'Furnace', 33),
          wiki('Iron_Anvil', 'Iron Anvil', 35),
          wiki('Lead_Anvil', 'Lead Anvil', 716),
          ent('i:3508', 'Copper Broadsword'),
          ent('i:3502', 'Tin Broadsword'),
        ),
      ],
    },
  ],
  checklist: [
    { id: 'gather-wood', text: 'Collect a big stack of wood (the wiki suggests about 200)' },
    { id: 'work-bench', text: 'Craft and place a Work Bench' },
    { id: 'backup-weapon', text: 'Craft a Wooden Sword or a Wooden Bow' },
    { id: 'torches', text: 'Collect Gel from slimes and craft Torches' },
    { id: 'house', text: 'Build a closed room with background walls and a door' },
    { id: 'furnish', text: 'Add a light source, a table and a chair' },
    { id: 'housing-query', text: 'Check the room with the housing query' },
    { id: 'talk-guide', text: 'Show the Guide an item to see what it crafts into' },
    { id: 'furnace', text: 'Build a Furnace and smelt your first bars' },
  ],
  advanced: {
    title: 'House rules and your world',
    blocks: [
      p(
        t`A valid ${wiki('House', 'house')} encloses at least 60 and fewer than 750 tiles, counting its frame, and it doesn’t have to be a rectangle. The article lists the exact wall, furniture and entrance rules if a room refuses to count.`,
      ),
      p(
        t`A standard world contains either the ${wiki('Corruption', 'Corruption')} or the ${wiki('Crimson', 'Crimson')}, and that choice decides your evil ore: Demonite for the Corruption, Crimtane for the Crimson (${wiki('Ores', 'Ores')}). It matters once you outgrow the regular ore tiers.`,
      ),
    ],
  },
}
