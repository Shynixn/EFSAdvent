import { Component, computed, signal } from '@angular/core';

/** A single browsable level card shown in the Level Explorer grid. */
export interface LevelCard {
  id: string;
  name: string;
  author: string;
  world: string;
  stageCount: number;
  /** Primary accent colour used for the card's hero banner. */
  accent: string;
  tags: string[];
}

@Component({
  selector: 'app-level-explorer-page',
  templateUrl: './level-explorer-page.html',
  styleUrl: './level-explorer-page.css',
})
export class LevelExplorerPage {
  /** Current search box contents (bound with two-way style via signal). */
  readonly search = signal('');

  /** Example data — replaced with a real backend later. */
  private readonly allLevels: LevelCard[] = [
    {
      id: 'shadow-keep',
      name: 'Shadow Keep',
      author: 'FairyDust',
      world: 'Kakariko Depths',
      stageCount: 6,
      accent: 'from-indigo-500 to-purple-600',
      tags: ['Puzzle', 'Dark'],
    },
    {
      id: 'verdant-trail',
      name: 'Verdant Trail',
      author: 'TingleTech',
      world: 'Great Sea',
      stageCount: 4,
      accent: 'from-emerald-500 to-teal-600',
      tags: ['Overworld', 'Co-op'],
    },
    {
      id: 'ember-caverns',
      name: 'Ember Caverns',
      author: 'Volvagia',
      world: 'Death Mountain',
      stageCount: 8,
      accent: 'from-orange-500 to-red-600',
      tags: ['Combat', 'Boss'],
    },
    {
      id: 'frostbite-ruins',
      name: 'Frostbite Ruins',
      author: 'Nayru',
      world: 'Frozen Wastes',
      stageCount: 5,
      accent: 'from-sky-500 to-blue-600',
      tags: ['Ice', 'Exploration'],
    },
    {
      id: 'sandstorm-citadel',
      name: 'Sandstorm Citadel',
      author: 'Gaepora',
      world: 'Desert of Hylia',
      stageCount: 7,
      accent: 'from-amber-500 to-yellow-600',
      tags: ['Defense', 'Puzzle'],
    },
    {
      id: 'twilight-grove',
      name: 'Twilight Grove',
      author: 'Midna',
      world: 'Lost Woods',
      stageCount: 3,
      accent: 'from-fuchsia-500 to-pink-600',
      tags: ['Stealth', 'Forest'],
    },
  ];

  /** Levels filtered by the current search query (name / author / tag). */
  readonly filteredLevels = computed(() => {
    const query = this.search().trim().toLowerCase();
    if (!query) {
      return this.allLevels;
    }
    return this.allLevels.filter((level) =>
      [level.name, level.author, level.world, ...level.tags]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  });

  /** Updates the search query from the input event. */
  onSearchInput(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }
}
