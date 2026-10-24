/** Shared state and actions for the view toolbar and rendered scene. */
export interface ViewControlState {
  axesVisible: boolean;
  /** User preference; placement may display the grid temporarily without changing this value. */
  gridEnabled: boolean;
  gridShownForPlacement: boolean;
  canFitView: boolean;
  canFocusSelected: boolean;
}

export interface ViewControlActions {
  setAxesVisible: (visible: boolean) => void;
  setGridVisible: (visible: boolean) => void;
  fitView: () => void;
  focusSelected: () => void;
}

export interface ViewControlContract {
  state: ViewControlState;
  actions: ViewControlActions;
}
