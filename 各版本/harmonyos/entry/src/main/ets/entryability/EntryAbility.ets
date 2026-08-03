/**
 * HarmonyOS鸿蒙应用 - EntryAbility
 */
import { UIAbility, WindowStage, AbilityConstant } from '@kit.AbilityKit';
import { hilog } from '@kit.Hilog';
import router from '@ohos.router';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchType): void {
    hilog.info(0x0000, 'EntryAbility', 'OnCreate');
  }

  onWindowStageCreate(windowStage: WindowStage): void {
    // Main window is created, set main page for this ability
    hilog.info(0x0000, 'EntryAbility', 'OnWindowStageCreate');

    windowStage.loadContent('pages/index/index', (err) => {
      if (err.code) {
        hilog.error(0x0000, 'EntryAbility', 'Failed to load content. Cause: %{public}s', JSON.stringify(err) ?? '');
        return;
      }
      hilog.info(0x0000, 'EntryAbility', 'Succeeded in loading content.');
    });
  }

  onForeground(): void {
    hilog.info(0x0000, 'EntryAbility', 'OnForeground');
  }

  onBackground(): void {
    hilog.info(0x0000, 'EntryAbility', 'OnBackground');
  }

  onDestroy(): void {
    hilog.info(0x0000, 'EntryAbility', 'OnDestroy');
  }

  onNewWant(want: Want, launchParam: AbilityConstant.LaunchType): void {
    hilog.info(0x0000, 'EntryAbility', 'OnNewWant');
    // Navigate based on want parameters
    const uri = want.uri;
    if (uri) {
      router.pushUrl({ url: uri }).catch((err) => {
        hilog.error(0x0000, 'EntryAbility', 'Navigation failed: %{public}s', JSON.stringify(err) ?? '');
      });
    }
  }
}
