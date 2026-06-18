import type { Tag } from './tagModels';

export function addOrReplaceTag(tags: Tag[], tag: Tag): Tag[] {
  const withoutExisting = tags.filter((item) => item.id !== tag.id);

  return [...withoutExisting, tag].sort((left, right) => left.name.localeCompare(right.name));
}

export function removeTag(tags: Tag[], id: number): Tag[] {
  return tags.filter((tag) => tag.id !== id);
}
