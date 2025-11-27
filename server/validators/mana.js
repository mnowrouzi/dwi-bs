export function validateMana(player, launcherConfig, manaConfig) {
  if (player.mana < launcherConfig.manaCost) {
    return { success: false, error: 'Insufficient mana' };
  }

  return { success: true };
}



