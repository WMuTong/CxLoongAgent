declare module "odometer" {
  type OdometerOptions = {
    duration?: number;
    el: HTMLElement;
    format?: string;
    theme?: string;
    value?: number | string;
  };

  export default class Odometer {
    constructor(options: OdometerOptions);
    render(value?: number | string): void;
    update(value: number | string): void;
  }
}
