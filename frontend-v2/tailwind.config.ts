import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
  	container: {
  		center: true,
  		padding: '2rem',
  		screens: {
  			'2xl': '1400px'
  		}
  	},
  	extend: {
  		colors: {
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			},
  			// Depth layer colors
  			surface: {
  				base: 'hsl(var(--bg-base))',
  				mid: 'hsl(var(--bg-mid))',
  				light: 'hsl(var(--bg-light))',
  				sunken: 'hsl(var(--bg-sunken))'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)',
  			xl: 'calc(var(--radius) + 4px)',
  			'2xl': 'calc(var(--radius) + 8px)'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			},
  			'fade-in': {
  				from: {
  					opacity: '0',
  					transform: 'translateY(8px)'
  				},
  				to: {
  					opacity: '1',
  					transform: 'translateY(0)'
  				}
  			},
  			'scale-in': {
  				from: {
  					opacity: '0',
  					transform: 'scale(0.95)'
  				},
  				to: {
  					opacity: '1',
  					transform: 'scale(1)'
  				}
  			},
			'slide-up': {
				from: {
					opacity: '0',
					transform: 'translateY(20px)'
				},
				to: {
					opacity: '1',
					transform: 'translateY(0)'
				}
			},
			'ripple-expand': {
				'0%': {
					transform: 'translate(-50%, -50%) scale(0)',
					opacity: '1'
				},
				'100%': {
					transform: 'translate(-50%, -50%) scale(1)',
					opacity: '0'
				}
			},
			'ripple-contract': {
				'0%': {
					transform: 'translate(-50%, -50%) scale(1)',
					opacity: '0'
				},
				'100%': {
					transform: 'translate(-50%, -50%) scale(0)',
					opacity: '1'
				}
			},
			'float': {
				'0%, 100%': {
					transform: 'translateY(0)'
				},
				'50%': {
					transform: 'translateY(-4px)'
				}
			},
			'gradient-blob-1': {
				'0%': {
					transform: 'translate(0, 0) scale(1)'
				},
				'25%': {
					transform: 'translate(200px, -100px) scale(1.1)'
				},
				'50%': {
					transform: 'translate(100px, 150px) scale(0.95)'
				},
				'75%': {
					transform: 'translate(-150px, 50px) scale(1.05)'
				},
				'100%': {
					transform: 'translate(0, 0) scale(1)'
				}
			},
			'gradient-blob-2': {
				'0%': {
					transform: 'translate(0, 0) scale(1)'
				},
				'25%': {
					transform: 'translate(-180px, 120px) scale(0.9)'
				},
				'50%': {
					transform: 'translate(150px, 80px) scale(1.08)'
				},
				'75%': {
					transform: 'translate(80px, -160px) scale(0.95)'
				},
				'100%': {
					transform: 'translate(0, 0) scale(1)'
				}
			},
			'gradient-blob-3': {
				'0%': {
					transform: 'translate(0, 0) scale(1)'
				},
				'25%': {
					transform: 'translate(120px, 100px) scale(1.06)'
				},
				'50%': {
					transform: 'translate(-200px, -50px) scale(0.92)'
				},
				'75%': {
					transform: 'translate(-100px, 180px) scale(1.04)'
				},
				'100%': {
					transform: 'translate(0, 0) scale(1)'
				}
			},
			'connected-dot-float': {
				'0%, 100%': {
					transform: 'translateY(0)'
				},
				'50%': {
					transform: 'translateY(-6px)'
				}
			},
			'connected-line-fade': {
				'0%, 100%': {
					opacity: '0.4'
				},
				'50%': {
					opacity: '1'
				}
			},
			'mesh-shimmer': {
				'0%': {
					transform: 'translate(0, 0) scale(1)',
					opacity: '0.03'
				},
				'50%': {
					transform: 'translate(30px, -20px) scale(1.1)',
					opacity: '0.06'
				},
				'100%': {
					transform: 'translate(0, 0) scale(1)',
					opacity: '0.03'
				}
			},
			'aurora-1': {
				'0%': {
					transform: 'translateX(0%) skewX(-5deg)'
				},
				'50%': {
					transform: 'translateX(15%) skewX(3deg)'
				},
				'100%': {
					transform: 'translateX(0%) skewX(-5deg)'
				}
			},
			'aurora-2': {
				'0%': {
					transform: 'translateX(0%) skewX(3deg)'
				},
				'50%': {
					transform: 'translateX(-12%) skewX(-4deg)'
				},
				'100%': {
					transform: 'translateX(0%) skewX(3deg)'
				}
			},
			'aurora-3': {
				'0%': {
					transform: 'translateX(0%) skewX(-2deg)'
				},
				'50%': {
					transform: 'translateX(10%) skewX(5deg)'
				},
				'100%': {
					transform: 'translateX(0%) skewX(-2deg)'
				}
			},
			'glow-breathe': {
				'0%, 100%': {
					opacity: '1',
					transform: 'translate(-50%, 0) scale(1)'
				},
				'50%': {
					opacity: '0.6',
					transform: 'translate(-50%, 0) scale(1.08)'
				}
			},
			'glow-breathe-delayed': {
				'0%, 100%': {
					opacity: '1',
					transform: 'scale(1)'
				},
				'50%': {
					opacity: '0.5',
					transform: 'scale(1.12)'
				}
			}
		},
		animation: {
			'accordion-down': 'accordion-down 0.2s ease-out',
			'accordion-up': 'accordion-up 0.2s ease-out',
			'fade-in': 'fade-in 0.3s ease-out',
			'scale-in': 'scale-in 0.2s ease-out',
			'slide-up': 'slide-up 0.4s ease-out',
			'ripple-expand': 'ripple-expand 700ms ease-out forwards',
			'ripple-contract': 'ripple-contract 700ms ease-out forwards',
			'float': 'float 3s ease-in-out infinite',
			'gradient-blob-1': 'gradient-blob-1 35s ease-in-out infinite',
			'gradient-blob-2': 'gradient-blob-2 40s ease-in-out infinite',
			'gradient-blob-3': 'gradient-blob-3 45s ease-in-out infinite',
			'mesh-shimmer': 'mesh-shimmer 20s ease-in-out infinite',
			'aurora-1': 'aurora-1 25s ease-in-out infinite',
			'aurora-2': 'aurora-2 30s ease-in-out infinite',
			'aurora-3': 'aurora-3 35s ease-in-out infinite',
			'glow-breathe': 'glow-breathe 8s ease-in-out infinite',
			'glow-breathe-delayed': 'glow-breathe-delayed 10s ease-in-out infinite 3s'
		},
  		boxShadow: {
  			'2xs': 'var(--shadow-2xs)',
  			xs: 'var(--shadow-xs)',
  			sm: 'var(--shadow-sm)',
  			DEFAULT: 'var(--shadow)',
  			md: 'var(--shadow-md)',
  			lg: 'var(--shadow-lg)',
  			xl: 'var(--shadow-xl)',
  			'2xl': 'var(--shadow-2xl)',
  			'inset-raised': 'var(--shadow-inset-raised)',
  			'inset-sunken': 'var(--shadow-inset-sunken)'
  		},
  		fontFamily: {
  			sans: [
  				'Source Sans Pro',
  				'ui-sans-serif',
  				'system-ui',
  				'-apple-system',
  				'BlinkMacSystemFont',
  				'Segoe UI',
  				'Roboto',
  				'Helvetica Neue',
  				'Arial',
  				'Noto Sans',
  				'sans-serif'
  			],
  			serif: [
  				'Source Serif Pro',
  				'ui-serif',
  				'Georgia',
  				'Cambria',
  				'Times New Roman',
  				'Times',
  				'serif'
  			],
  			mono: [
  				'Source Code Pro',
  				'ui-monospace',
  				'SFMono-Regular',
  				'Menlo',
  				'Monaco',
  				'Consolas',
  				'Liberation Mono',
  				'Courier New',
  				'monospace'
  			]
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
