export type ViewerActions = {
  jumpToPage(page: number): void;
  searchNext(): void;
  searchPrevious(): void;
  zoomIn(): void;
  zoomOut(): void;
  fitWidth(): void;
  fitPage(): void;
};

export class ViewerController {
  private actions: ViewerActions | null = null;

  bind(actions: ViewerActions): void {
    this.actions = actions;
  }

  clear(): void {
    this.actions = null;
  }

  jumpToPage(page: number): boolean {
    return this.run((actions) => actions.jumpToPage(page));
  }

  searchNext(): boolean {
    return this.run((actions) => actions.searchNext());
  }

  searchPrevious(): boolean {
    return this.run((actions) => actions.searchPrevious());
  }

  zoomIn(): boolean {
    return this.run((actions) => actions.zoomIn());
  }

  zoomOut(): boolean {
    return this.run((actions) => actions.zoomOut());
  }

  fitWidth(): boolean {
    return this.run((actions) => actions.fitWidth());
  }

  fitPage(): boolean {
    return this.run((actions) => actions.fitPage());
  }

  private run(command: (actions: ViewerActions) => void): boolean {
    if (!this.actions) {
      return false;
    }

    command(this.actions);
    return true;
  }
}
