import {
  BookOpen,
  ClipboardList,
  Compass,
  Folder,
  GraduationCap,
  Library,
  Lightbulb,
  Presentation,
  Shapes,
  Star,
  Target,
  Users,
} from 'lucide-react';
import type { ModuleIcon } from '@ops/shared';

/** Module icon slug → lucide component. Keep keys in sync with MODULE_ICONS
 *  in packages/shared/src/schema/module.ts. */
export const MODULE_ICON_COMPONENTS: Record<ModuleIcon, React.ElementType> = {
  shapes: Shapes,
  'book-open': BookOpen,
  'graduation-cap': GraduationCap,
  users: Users,
  'clipboard-list': ClipboardList,
  folder: Folder,
  star: Star,
  compass: Compass,
  lightbulb: Lightbulb,
  target: Target,
  library: Library,
  presentation: Presentation,
};

export function moduleIconComponent(icon: string): React.ElementType {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- icon may be any string from Firestore; cast does not guarantee a matching key
  return MODULE_ICON_COMPONENTS[icon as ModuleIcon] ?? Shapes;
}
