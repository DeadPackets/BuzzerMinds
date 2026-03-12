"use client";

import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Slider } from "@/components/ui/slider";

export function SettingSlider({
  label,
  description,
  min,
  max,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  description: string;
  min: number;
  max: number;
  value: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  return (
    <FieldGroup>
      <Field>
        <FieldContent>
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>{label}</FieldLabel>
            <span className="text-sm font-semibold text-[var(--text-bright)]">{value}</span>
          </div>
          <FieldDescription>{description}</FieldDescription>
          <Slider
            disabled={disabled}
            max={max}
            min={min}
            step={1}
            value={[value]}
            onValueChange={(next) => onCommit(next[0] ?? value)}
          />
        </FieldContent>
      </Field>
    </FieldGroup>
  );
}
