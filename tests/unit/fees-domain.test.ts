import { describe, expect, it } from "vitest";

import { toCsv, escapeCsvField } from "@/modules/fees/domain/csv";
import {
  formatMinorUnitsAsDecimalString,
  sumMinorUnits,
} from "@/modules/fees/domain/money";
import {
  deriveChargeBalance,
  runningBalance,
  type ChargeBalance,
} from "@/modules/fees/domain/balance";

describe("sumMinorUnits", () => {
  it("adds a list of integers exactly", () => {
    expect(sumMinorUnits([100, 200, 50])).toBe(350);
  });

  it("sums to zero for an empty list", () => {
    expect(sumMinorUnits([])).toBe(0);
  });

  it("handles negative amounts (an overpayment reversal)", () => {
    expect(sumMinorUnits([1000, -200])).toBe(800);
  });
});

describe("formatMinorUnitsAsDecimalString", () => {
  it("renders a typical amount", () => {
    expect(formatMinorUnitsAsDecimalString(6750)).toBe("67.50");
  });

  it("pads a single-digit cents value", () => {
    expect(formatMinorUnitsAsDecimalString(605)).toBe("6.05");
  });

  it("renders zero", () => {
    expect(formatMinorUnitsAsDecimalString(0)).toBe("0.00");
  });

  it("renders a negative amount (overpayment) with the sign on the whole string", () => {
    expect(formatMinorUnitsAsDecimalString(-1234)).toBe("-12.34");
  });

  it("renders an amount under one unit", () => {
    expect(formatMinorUnitsAsDecimalString(5)).toBe("0.05");
    expect(formatMinorUnitsAsDecimalString(-5)).toBe("-0.05");
  });
});

describe("deriveChargeBalance", () => {
  const OPEN = { amount: 1000, status: "OPEN" as const };

  it("is OPEN with no payments", () => {
    const balance = deriveChargeBalance(OPEN, []);
    expect(balance).toEqual({ paidAmount: 0, openAmount: 1000, state: "OPEN" });
  });

  it("is PARTIAL when paid less than the amount", () => {
    const balance = deriveChargeBalance(OPEN, [{ amount: 400 }]);
    expect(balance).toEqual({
      paidAmount: 400,
      openAmount: 600,
      state: "PARTIAL",
    });
  });

  it("is PAID when paid exactly the amount", () => {
    const balance = deriveChargeBalance(OPEN, [{ amount: 1000 }]);
    expect(balance).toEqual({ paidAmount: 1000, openAmount: 0, state: "PAID" });
  });

  it("is PAID (not a fourth state) when overpaid, with a negative openAmount", () => {
    const balance = deriveChargeBalance(OPEN, [{ amount: 1200 }]);
    expect(balance).toEqual({
      paidAmount: 1200,
      openAmount: -200,
      state: "PAID",
    });
  });

  it("sums multiple payments", () => {
    const balance = deriveChargeBalance(OPEN, [
      { amount: 300 },
      { amount: 300 },
      { amount: 400 },
    ]);
    expect(balance).toEqual({ paidAmount: 1000, openAmount: 0, state: "PAID" });
  });

  it("is WAIVED regardless of payments — the administrative decision wins", () => {
    const balance = deriveChargeBalance({ amount: 1000, status: "WAIVED" }, [
      { amount: 200 },
    ]);
    expect(balance.state).toBe("WAIVED");
  });

  it("is CANCELLED regardless of payments", () => {
    const balance = deriveChargeBalance(
      { amount: 1000, status: "CANCELLED" },
      [],
    );
    expect(balance.state).toBe("CANCELLED");
  });
});

describe("runningBalance", () => {
  function balance(
    state: ChargeBalance["state"],
    openAmount: number,
  ): ChargeBalance {
    return { paidAmount: 0, openAmount, state };
  }

  it("sums the open amounts of ordinary charges", () => {
    expect(
      runningBalance([balance("OPEN", 500), balance("PARTIAL", 300)]),
    ).toBe(800);
  });

  it("excludes WAIVED and CANCELLED charges entirely", () => {
    expect(
      runningBalance([
        balance("OPEN", 500),
        balance("WAIVED", 900),
        balance("CANCELLED", 700),
      ]),
    ).toBe(500);
  });

  it("is zero once every open charge is paid in full", () => {
    expect(runningBalance([balance("PAID", 0), balance("PAID", 0)])).toBe(0);
  });

  it("can be negative (a net overpayment across open charges)", () => {
    expect(runningBalance([balance("PAID", -100)])).toBe(-100);
  });

  it("is zero for an empty set", () => {
    expect(runningBalance([])).toBe(0);
  });
});

describe("escapeCsvField", () => {
  it("leaves a plain value bare", () => {
    expect(escapeCsvField("ABC-123")).toBe("ABC-123");
  });

  it("quotes a value containing a comma", () => {
    expect(escapeCsvField("Vries, Sanne de")).toBe('"Vries, Sanne de"');
  });

  it("doubles an embedded quote", () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes a value containing a line break", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("toCsv", () => {
  it("is deterministic: the same input always produces the same bytes", () => {
    const header = ["a", "b"];
    const rows = [
      ["1", "2"],
      ["3", "4"],
    ];
    expect(toCsv(header, rows)).toBe(toCsv(header, rows));
  });

  it("uses CRLF line endings throughout, per RFC 4180", () => {
    const csv = toCsv(["a"], [["1"], ["2"]]);
    expect(csv).toBe("a\r\n1\r\n2\r\n");
  });

  it("escapes fields that need it, leaving the rest bare", () => {
    const csv = toCsv(["name", "note"], [["Sanne", "contributie, Q3"]]);
    expect(csv).toBe('name,note\r\nSanne,"contributie, Q3"\r\n');
  });

  it("renders an empty row set as just the header", () => {
    expect(toCsv(["a", "b"], [])).toBe("a,b\r\n");
  });
});
