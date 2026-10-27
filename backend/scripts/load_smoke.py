"""Compatibility entry point for the guarded isolated READ load runner.

The old arbitrary-target/positional-argument runner was retired: it could send
unpaced requests to production. Use the flags documented by --help instead.
"""

from load_capacity import cli

if __name__ == "__main__":
    cli()
