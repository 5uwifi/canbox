package bitswap

import (
	"context"

	bsnet "github.com/ipfs/go-ipfs/exchange/bitswap/network"

	mockpeernet "github.com/libp2p/go-libp2p/p2p/net/mock"
	mockrouting "gx/ipfs/QmbFRJeEmEU16y3BmKKaD4a9fm5oHsEAMHe2vSB1UnfLMi/go-ipfs-routing/mock"
	testutil "gx/ipfs/QmcW4FGAt24fdK1jBgWQn3yP4R9ZLyWQqjozv9QK7epRhL/go-testutil"
	peer "github.com/libp2p/go-libp2p-peer"
	ds "github.com/ipfs/go-datastore"
)

type peernet struct {
	mockpeernet.Mocknet
	routingserver mockrouting.Server
}

func StreamNet(ctx context.Context, net mockpeernet.Mocknet, rs mockrouting.Server) (Network, error) {
	return &peernet{net, rs}, nil
}

func (pn *peernet) Adapter(p testutil.Identity) bsnet.BitSwapNetwork {
	client, err := pn.Mocknet.AddPeer(p.PrivateKey(), p.Address())
	if err != nil {
		panic(err.Error())
	}
	routing := pn.routingserver.ClientWithDatastore(context.TODO(), p, ds.NewMapDatastore())
	return bsnet.NewFromIpfsHost(client, routing)
}

func (pn *peernet) HasPeer(p peer.ID) bool {
	for _, member := range pn.Mocknet.Peers() {
		if p == member {
			return true
		}
	}
	return false
}

var _ Network = (*peernet)(nil)
