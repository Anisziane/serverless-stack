import { styled } from "~/stitches.config";

export const Badge = styled("div", {
  fontWeight: 600,
  textAlign: "center",
  display: "inline-block",
  lineHeight: 1.5,
  variants: {
    size: {
      sm: {
        padding: "$xxs $md",
        borderRadius: "4px",
        fontSize: "$sm",
      },
    },
    color: {
      success: {
        background: "$green5",
        color: "$green10",
      },
      danger: {
        background: "$red5",
        color: "$red10",
      },
      neutral: {
        background: "$gray6",
        color: "$gray11",
      },
    },
  },
  defaultVariants: {
    size: "sm",
    color: "neutral",
  },
});
