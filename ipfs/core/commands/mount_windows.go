package commands

import (
	"errors"

	cmds "github.com/ipfs/go-ipfs/commands"

	cmdkit "github.com/ipfs/go-ipfs-cmdkit"
)

var MountCmd = &cmds.Command{
	Helptext: cmdkit.HelpText{
		Tagline:          "Not yet implemented on Windows.",
		ShortDescription: "Not yet implemented on Windows. :(",
	},

	Run: func(req cmds.Request, res cmds.Response) {
		res.SetError(errors.New("Mount isn't compatible with Windows yet"), cmdkit.ErrNormal)
	},
}
