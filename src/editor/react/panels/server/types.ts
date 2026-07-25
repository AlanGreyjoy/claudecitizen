export type AdminTab =
  | 'users'
  | 'ships'
  | 'props'
  | 'items'
  | 'weapons'
  | 'backpacks'
  | 'wearables'
  | 'settings';

export type AdminScene =
  | 'login'
  | 'users'
  | 'user-detail'
  | 'ships'
  | 'ship-form'
  | 'props'
  | 'prop-form'
  | 'items'
  | 'item-form'
  | 'weapons'
  | 'weapon-form'
  | 'backpacks'
  | 'backpack-form'
  | 'wearables'
  | 'wearable-form'
  | 'settings';

export type ServerConsoleStatus = {
  message: string;
  isError: boolean;
};

export type ServerRoute =
  | { scene: 'login' }
  | { scene: 'users' }
  | { scene: 'user-detail'; userId: string }
  | { scene: 'ships' }
  | { scene: 'ship-form'; shipId: string | null }
  | { scene: 'props' }
  | { scene: 'prop-form'; propId: string | null }
  | { scene: 'items' }
  | { scene: 'item-form'; itemId: string | null }
  | { scene: 'weapons' }
  | { scene: 'weapon-form'; weaponId: string | null }
  | { scene: 'backpacks' }
  | { scene: 'backpack-form'; backpackId: string | null }
  | { scene: 'wearables' }
  | { scene: 'wearable-form'; wearableId: string | null }
  | { scene: 'settings' };

export function routeTab(route: ServerRoute): AdminTab {
  if (route.scene === 'login') return 'users';
  if (route.scene === 'user-detail') return 'users';
  if (route.scene === 'ship-form') return 'ships';
  if (route.scene === 'prop-form') return 'props';
  if (route.scene === 'item-form') return 'items';
  if (route.scene === 'weapon-form') return 'weapons';
  if (route.scene === 'backpack-form') return 'backpacks';
  if (route.scene === 'wearable-form') return 'wearables';
  return route.scene;
}

export function routeScene(route: ServerRoute): AdminScene {
  if (route.scene === 'user-detail') return 'user-detail';
  if (route.scene === 'ship-form') return 'ship-form';
  if (route.scene === 'prop-form') return 'prop-form';
  if (route.scene === 'item-form') return 'item-form';
  if (route.scene === 'weapon-form') return 'weapon-form';
  if (route.scene === 'backpack-form') return 'backpack-form';
  if (route.scene === 'wearable-form') return 'wearable-form';
  if (route.scene === 'login') return 'login';
  return route.scene;
}
