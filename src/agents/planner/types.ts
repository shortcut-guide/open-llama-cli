export type MicroPlan = {
  file: string;
  responsibility: string;
  extractFocus: string;
};

export type MacroPlan = {
  plans: MicroPlan[];
};
