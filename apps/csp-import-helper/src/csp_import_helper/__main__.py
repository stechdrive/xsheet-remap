from .dpi import enable_windows_dpi_awareness

enable_windows_dpi_awareness()

from .cli import main


if __name__ == "__main__":
    raise SystemExit(main())
