import Odometer from "odometer";
import { useEffect, useMemo, useRef } from "react";

type AnimatedNumberProps = {
  className?: string;
  format?: string;
  prefix?: string;
  suffix?: string;
  value: number;
};

export function AnimatedNumber({
  className = "",
  format = "(,ddd)",
  prefix,
  suffix,
  value,
}: AnimatedNumberProps) {
  const elementRef = useRef<HTMLSpanElement | null>(null);
  const odometerRef = useRef<Odometer | null>(null);
  const initialValue = useRef(value);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.innerHTML = String(initialValue.current);
    odometerRef.current = new Odometer({
      el: element,
      value: initialValue.current,
      format,
      theme: "minimal",
    });
    odometerRef.current.render();
  }, [format]);

  useEffect(() => {
    odometerRef.current?.update(value);
  }, [value]);

  return (
    <span className={`animated-number ${className}`.trim()}>
      {prefix ? <span className="animated-number-affix">{prefix}</span> : null}
      <span ref={elementRef} className="animated-number-value odometer">
        {initialValue.current}
      </span>
      {suffix ? <span className="animated-number-affix">{suffix}</span> : null}
    </span>
  );
}

type CompactNumberParts = {
  format: string;
  suffix: string;
  value: number;
};

export function to_animated_compact_number(value: number | null | undefined): CompactNumberParts {
  const normalized = value ?? 0;
  if (Math.abs(normalized) >= 1_000_000) {
    return compact_parts(normalized / 1_000_000, "M");
  }
  if (Math.abs(normalized) >= 1_000) {
    return compact_parts(normalized / 1_000, "K");
  }
  return {
    value: normalized,
    suffix: "",
    format: "(,ddd)",
  };
}

export function to_animated_percent(value: number | null | undefined): CompactNumberParts {
  const normalized = value === null || value === undefined || !Number.isFinite(value) ? 0 : value;
  return compact_parts(normalized * 100, "%");
}

export function AnimatedCompactNumber({
  className,
  value,
}: {
  className?: string;
  value: number | null | undefined;
}) {
  const parts = useMemo(() => to_animated_compact_number(value), [value]);
  return (
    <AnimatedNumber className={className} key={`${parts.format}:${parts.suffix}`} {...parts} />
  );
}

export function AnimatedPercent({
  className,
  value,
}: {
  className?: string;
  value: number | null | undefined;
}) {
  const parts = useMemo(() => to_animated_percent(value), [value]);
  return (
    <AnimatedNumber className={className} key={`${parts.format}:${parts.suffix}`} {...parts} />
  );
}

function compact_parts(value: number, suffix: string): CompactNumberParts {
  const rounded = Number(value.toFixed(1));
  return {
    value: rounded,
    suffix,
    format: Number.isInteger(rounded) ? "(,ddd)" : "(,ddd).d",
  };
}
