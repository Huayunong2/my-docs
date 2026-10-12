import { forwardRef, type InputHTMLAttributes } from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "../../lib/utils";

// The semantic input keeps form, label, keyboard and indeterminate behavior;
// all visible geometry belongs to this shared component.
type ChoiceProps = InputHTMLAttributes<HTMLInputElement>;
const Choice = forwardRef<HTMLInputElement, ChoiceProps>(function Choice({ className, style, type = "checkbox", ...props }, ref) {
  return <span className={cn("ui-choice", className)} style={style} data-variant={type}>
    <input {...props} type={type} ref={ref} className="ui-choice-input"/>
    <span className="ui-choice-mark" aria-hidden="true"><Check className="ui-choice-check" size={14}/><Minus className="ui-choice-mixed" size={14}/></span>
  </span>;
});
export const Checkbox = forwardRef<HTMLInputElement, ChoiceProps>(function Checkbox(props, ref) {
  return <Choice {...props} type="checkbox" ref={ref}/>;
});
export const Radio = forwardRef<HTMLInputElement, ChoiceProps>(function Radio(props, ref) {
  return <Choice {...props} type="radio" ref={ref}/>;
});
