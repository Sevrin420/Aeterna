// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// A stand-in for $THROBBIN in the tests. Decimals are a constructor argument
/// because the real token's are not knowable from here, and the whole point of
/// the token price being in smallest units is that 18 must not be assumed.
contract MockERC20 is ERC20 {
    uint8 private immutable _dp;

    constructor(string memory n, string memory s, uint8 dp) ERC20(n, s) {
        _dp = dp;
    }

    function decimals() public view override returns (uint8) { return _dp; }

    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// Takes a cut on every transfer. Exists to prove mintWithToken refuses rather
/// than selling a Bloodline for less than the price.
contract FeeERC20 is ERC20 {
    uint256 public immutable feeBps;

    constructor(uint256 _feeBps) ERC20("Fee", "FEE") { feeBps = _feeBps; }

    function mint(address to, uint256 amount) external { _mint(to, amount); }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || feeBps == 0) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = (value * feeBps) / 10000;
        super._update(from, to, value - fee);
        super._update(from, address(0xdead), fee);
    }
}

/// Calls back into the collection while the tokens are moving. Exists to prove
/// the reentrancy guard holds.
interface IMintWithToken { function mintWithToken(uint256) external returns (uint256); }

contract ReentrantERC20 is ERC20 {
    address public target;
    bool private _armed;

    constructor() ERC20("Reentrant", "RE") {}

    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function arm(address t) external { target = t; _armed = true; }

    function _update(address from, address to, uint256 value) internal override {
        if (_armed && to == target) {
            _armed = false;
            IMintWithToken(target).mintWithToken(1);
        }
        super._update(from, to, value);
    }
}
