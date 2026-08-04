import logging
import sys
from config import settings


def get_logger(name: str) -> logging.Logger:
    """Returns a consistently configured logger."""
    logger = logging.getLogger(name)

    if logger.handlers:
        return logger   

    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    logger.setLevel(level)

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level)

    formatter = logging.Formatter(
        fmt="%(asctime)s  [%(levelname)-8s]  %(name)s — %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)

    return logger